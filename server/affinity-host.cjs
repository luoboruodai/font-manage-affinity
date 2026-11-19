'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { AffinityMCP, toolText } = require('./affinity-mcp.cjs');
const { affinityScript } = require('./affinity-script.cjs');

const exec = promisify(execFile);
const labels = {
  disconnected: '未连接', detecting: '正在检测 Affinity', 'starting-connector': '正在启动连接组件',
  connecting: '正在连接', connected: '已连接', 'host-not-running': 'Affinity 未运行',
  'waiting-host': '正在等待 Affinity 就绪', incompatible: '版本不兼容',
  'permission-denied': '权限不足', failed: '连接失败', reconnecting: '正在重连'
};

class AffinityHost {
  constructor({ root, dataDir, getSettings = () => ({}), clientFactory = options => new AffinityMCP(options) }) {
    this.root = root;
    this.dataDir = dataDir;
    this.getSettings = getSettings;
    this.clientFactory = clientFactory;
    this.hostSource = fs.readFileSync(path.join(root, 'src', 'host.js'), 'utf8');
    this.state = {
      connected: false, status: 'disconnected', statusText: labels.disconnected,
      document: '', documentId: '', count: 0, font: '', editable: false,
      signature: '', error: '', retryAt: 0, affinityCount: 0
    };
    this.affinityIDs = [];
    this.client = null;
    this.timer = null;
    this.busy = false;
    this.mutating = false;
    this.stopped = false;
    this.lastLaunch = 0;
  }

  start() { this.schedule(0); }

  snapshot() {
    return { ...this.state, affinityIDs: this.affinityIDs, retryAt: this.state.retryAt || undefined };
  }

  setStatus(status, patch = {}) {
    const previous = `${this.state.status}|${this.state.error}`;
    this.state = {
      ...this.state, ...patch, status, statusText: labels[status] || status,
      connected: status === 'connected', error: patch.error || ''
    };
    if (status !== 'connected') {
      this.state.count = 0;
      this.state.font = '';
      this.state.signature = '';
      this.state.editable = false;
    }
    const next = `${this.state.status}|${this.state.error}`;
    if (previous !== next) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      const detail = this.state.error ? ` · ${this.state.error}` : '';
      fs.appendFileSync(path.join(this.dataDir, 'affinity.log'), `${new Date().toISOString()} ${this.state.statusText}${detail}\n`);
    }
  }

  schedule(delay = 1000) {
    clearTimeout(this.timer);
    if (this.stopped) return;
    if (delay > 0 && this.state.status !== 'connected') this.state.retryAt = Date.now() + delay;
    else this.state.retryAt = 0;
    this.timer = setTimeout(() => this.tick(), delay);
    this.timer.unref?.();
  }

  async running() {
    try {
      await exec('pgrep', ['-f', '^/Applications/Affinity.app/Contents/MacOS/Affinity']);
      return true;
    } catch { return false; }
  }

  async tick() {
    if (this.busy || this.mutating || this.stopped) { this.schedule(500); return; }
    this.busy = true;
    let delay = 1000;
    try {
      if (!this.client) {
        this.setStatus(this.state.status === 'disconnected' ? 'detecting' : 'reconnecting');
        this.client = this.clientFactory({
          onClose: () => {
            if (this.stopped) return;
            this.client = null;
            this.setStatus('reconnecting', { error: '本机连接已断开' });
            this.schedule(2500);
          }
        });
        this.setStatus('starting-connector');
        await this.client.connect();
        this.setStatus('connecting');
        await this.client.callTool('read_sdk_documentation_topic', { filename: 'preamble' });
      }
      if (!this.client.ready) throw Error('Affinity 握手尚未完成');
      const value = await this.execute('status', { includeFonts: this.affinityIDs.length === 0 });
      if (value.fonts) this.affinityIDs = value.fonts.map(font => font.id);
      this.setStatus('connected', {
        document: value.document, documentId: value.documentId, count: value.count,
        font: value.font, editable: value.editable, signature: value.signature,
        affinityCount: this.affinityIDs.length
      });
    } catch (error) {
      delay = 3000;
      const message = String(error.message || error);
      if (this.client) { this.client.close(); this.client = null; }
      if (/PERMISSION_DENIED|permission|权限/i.test(message)) {
        this.setStatus('permission-denied', { error: message });
      } else if (/protocol|版本|Unsupported/i.test(message)) {
        this.setStatus('incompatible', { error: message });
      } else if (!await this.running()) {
        if (this.getSettings().affinityAutoLaunch !== false) {
          if (Date.now() - this.lastLaunch > 15000) {
            this.lastLaunch = Date.now();
            exec('/usr/bin/open', ['-b', 'com.canva.affinity']).catch(() => {});
          }
          this.setStatus('waiting-host', { error: '正在启动 Affinity 并等待本机服务' });
        } else {
          this.setStatus('host-not-running', { error: '启动 Affinity 后会自动连接' });
        }
      } else {
        this.setStatus(this.state.status === 'connected' ? 'reconnecting' : 'failed', { error: message });
      }
    } finally {
      this.busy = false;
      this.schedule(delay);
    }
  }

  async execute(action, payload = {}) {
    if (!this.client?.ready) throw Error(this.state.statusText || 'Affinity 未连接');
    const result = await this.client.callTool('execute_script', {
      script: affinityScript(this.hostSource, action, payload)
    });
    const text = toolText(result);
    const match = /(?:^|\r?\n)FONT_MANAGE_RESULT (.+?)(?=\r?\n|$)/.exec(text);
    if (!match) throw Error(text.trim() || 'Affinity 没有返回可识别的结果');
    const value = JSON.parse(match[1]);
    if (!value.ok) throw Error(value.error || 'Affinity 操作失败');
    return value;
  }

  async apply(font, signature) {
    if (this.mutating) throw Error('上一项应用正在完成');
    if (!this.state.connected) throw Error(`Affinity 尚未连接：${this.state.statusText}`);
    this.mutating = true;
    try {
      const value = await this.execute('apply', { font, signature });
      if (!value.verified) throw Error(`Affinity 未能确认目标字款（当前 ${value.font || '混合字体'}）`);
      this.setStatus('connected', {
        document: value.document, documentId: value.documentId, count: value.count,
        font: value.font, editable: value.editable, signature: value.signature
      });
      return value;
    } finally {
      this.mutating = false;
      this.schedule(0);
    }
  }

  async reconnect() {
    if (this.client) { this.client.close(); this.client = null; }
    this.setStatus('reconnecting');
    if (!await this.running()) await exec('/usr/bin/open', ['-b', 'com.canva.affinity']);
    this.schedule(0);
  }

  async focus() { await exec('/usr/bin/open', ['-b', 'com.canva.affinity']); }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    if (this.client) this.client.close();
    this.client = null;
  }
}

module.exports = { AffinityHost, labels };
