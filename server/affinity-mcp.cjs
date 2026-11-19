'use strict';

const DEFAULT_URL = 'http://[::1]:6767/sse';
const PROTOCOL_VERSION = '2025-11-25';

class AffinityMCP {
  constructor({ url = DEFAULT_URL, requestTimeout = 15000, onClose = () => {} } = {}) {
    this.url = new URL(url);
    if (this.url.protocol !== 'http:' || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(this.url.hostname)) {
      throw Error('Affinity 连接仅允许本机地址');
    }
    this.requestTimeout = requestTimeout;
    this.onClose = onClose;
    this.seq = 0;
    this.pending = new Map();
    this.endpoint = null;
    this.ready = false;
    this.tools = [];
    this.controller = null;
    this.closed = false;
  }

  async connect() {
    this.close();
    this.closed = false;
    this.controller = new AbortController();
    let endpointResolve, endpointReject;
    const endpointFound = new Promise((resolve, reject) => { endpointResolve = resolve; endpointReject = reject; });
    const response = await fetch(this.url, {
      headers: { Accept: 'text/event-stream' },
      signal: this.controller.signal
    });
    if (!response.ok) throw Error(`Affinity SSE 返回 ${response.status}`);
    const consumption = this.consume(response.body, endpointResolve).catch(error => { endpointReject(error); }).finally(() => {
      const wasReady = this.ready;
      this.ready = false;
      this.endpoint = null;
      this.rejectPending(Error('Affinity 连接已断开'));
      if (!this.closed || wasReady) this.onClose();
    });
    this.consumption = consumption;
    let endpointTimer;
    const timeout = new Promise((_, reject) => {
      endpointTimer = setTimeout(() => reject(Error('等待 Affinity SSE 端点超时')), this.requestTimeout);
      endpointTimer.unref?.();
    });
    try { await Promise.race([endpointFound, timeout]); } finally { clearTimeout(endpointTimer); }
    const init = await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'font-manage', version: '0.3.0' }
    });
    if (init.protocolVersion && init.protocolVersion !== PROTOCOL_VERSION) {
      throw Error(`不支持的 Affinity MCP 协议：${init.protocolVersion}`);
    }
    await this.notify('notifications/initialized');
    const listed = await this.request('tools/list', {});
    this.tools = (listed.tools || []).map(tool => tool.name);
    if (!this.tools.includes('execute_script')) throw Error('Affinity 没有提供 execute_script');
    this.ready = true;
    return this.tools;
  }

  async consume(stream, endpointFound) {
    const decoder = new TextDecoder();
    let buffer = '';
    let event = 'message';
    let data = [];
    const dispatch = async block => {
      const lines = block.split(/\r?\n/);
      event = 'message';
      data = [];
      for (const line of lines) {
        if (!line || line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
      }
      if (!data.length) return;
      const text = data.join('\n');
      if (event === 'endpoint') {
        const endpoint = new URL(text, this.url);
        if (endpoint.origin !== this.url.origin) throw Error('Affinity 返回了非本机消息端点');
        this.endpoint = endpoint;
        endpointFound(endpoint);
      } else if (event === 'message') {
        const message = JSON.parse(text);
        this.handleMessage(message);
      }
    };
    for await (const chunk of stream) {
      buffer += decoder.decode(chunk, { stream: true });
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        await dispatch(block);
      }
    }
  }

  handleMessage(message) {
    if (message.id === undefined || !this.pending.has(message.id)) return;
    const item = this.pending.get(message.id);
    this.pending.delete(message.id);
    clearTimeout(item.timer);
    if (message.error) item.reject(Error(message.error.message || JSON.stringify(message.error)));
    else item.resolve(message.result || {});
  }

  rejectPending(error) {
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    this.pending.clear();
  }

  async post(message) {
    if (!this.endpoint) throw Error('Affinity 消息端点尚未就绪');
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify(message),
      signal: this.controller.signal
    });
    if ([404, 410].includes(response.status)) {
      this.controller.abort();
      throw Error('Affinity 会话已过期');
    }
    if (!response.ok) throw Error(`Affinity 消息发送失败：${response.status}`);
    if ((response.headers.get('content-type') || '').includes('application/json')) {
      const body = await response.json();
      this.handleMessage(body);
    } else {
      await response.arrayBuffer();
    }
  }

  request(method, params) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error(`Affinity 请求超时：${method}`));
      }, this.requestTimeout);
      this.pending.set(id, { resolve, reject, timer });
      this.post({ jsonrpc: '2.0', id, method, params }).catch(error => {
        const item = this.pending.get(id);
        if (!item) return;
        this.pending.delete(id);
        clearTimeout(item.timer);
        item.reject(error);
      });
    });
  }

  async notify(method, params = {}) {
    await this.post({ jsonrpc: '2.0', method, params });
  }

  async callTool(name, args = {}) {
    if (!this.ready) throw Error('Affinity 握手尚未完成');
    const result = await this.request('tools/call', { name, arguments: args });
    if (result.isError) {
      const text = (result.content || []).map(item => item.text || '').join('\n');
      throw Error(text || `${name} 调用失败`);
    }
    return result;
  }

  close() {
    this.closed = true;
    this.ready = false;
    this.endpoint = null;
    if (this.controller) this.controller.abort();
    this.controller = null;
    this.rejectPending(Error('Affinity 连接已关闭'));
  }
}

function toolText(result) {
  return (result.content || []).filter(item => item.type === 'text' || item.text).map(item => item.text || '').join('\n');
}

module.exports = { AffinityMCP, DEFAULT_URL, PROTOCOL_VERSION, toolText };
