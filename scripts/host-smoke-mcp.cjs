'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { AffinityMCP, toolText } = require('../server/affinity-mcp.cjs');
const { affinityScript } = require('../server/affinity-script.cjs');

const root = path.resolve(__dirname, '..');
const hostSource = fs.readFileSync(path.join(root, 'src', 'host.js'), 'utf8');
const evidence = path.join(root, 'private', 'validation', 'v05');
fs.mkdirSync(evidence, { recursive: true });

const watchdog = setTimeout(() => { console.error('宿主 QA 超时'); process.exit(2); }, 90000);

(async () => {
  const client = new AffinityMCP({ requestTimeout: 15000 });
  const checks = [];
  function check(value, label, detail) {
    if (!value) throw Error(label + (detail ? `：${JSON.stringify(detail)}` : ''));
    checks.push({ label, result: 'PASS', detail });
  }
  async function run(action, payload = {}) {
    const response = await client.callTool('execute_script', { script: affinityScript(hostSource, action, payload) });
    const text = toolText(response), match = /FONT_MANAGE_RESULT (.+?)(?=\r?\n|$)/.exec(text);
    if (!match) throw Error(text || '没有宿主结果');
    return JSON.parse(match[1]);
  }
  try {
    await client.connect();
    await client.callTool('read_sdk_documentation_topic', { filename: 'preamble' });
    if (process.argv.includes('--create')) {
      const created = await run('qa-create');
      check(created.ok && created.created && created.count === 1, '创建独立 QA 文本对象', created);
      const inspected = await run('qa-inspect');
      check(inspected.text === 'ABCD' && inspected.size === 40 && inspected.fonts.every(font => font === 'ArialMT'), 'QA 初始文字、字号和字体', inspected);
      fs.writeFileSync(path.join(evidence, 'host-created.json'), JSON.stringify({ checks, created, inspected }, null, 2));
    } else {
      if (process.argv.includes('--prepare')) {
        await run('qa-select-all');
        const current = await run('status');
        const prepared = await run('apply', { font: 'Arial-BoldMT', signature: current.signature });
        check(prepared.verified, '恢复整段 QA 基线', prepared);
      }
      const uiApplied = await run('qa-inspect');
      check(uiApplied.fonts.every(font => font === 'Arial-BoldMT'), '原生窗口点击应用 Arial Bold', uiApplied);
      check(uiApplied.text === 'ABCD' && uiApplied.size === 40, '应用后保留文字与字号', uiApplied);
      await run('qa-undo');
      const undone = await run('qa-inspect');
      check(undone.fonts.every(font => font === 'ArialMT'), '一次撤销恢复 Arial Regular', undone);
      await run('qa-range');
      const ranged = await run('status');
      const rangeApplied = await run('apply', { font: 'Georgia', signature: ranged.signature });
      check(rangeApplied.verified, '字符范围应用后宿主确认', rangeApplied);
      const rangeInspected = await run('qa-inspect');
      check(JSON.stringify(rangeInspected.fonts) === JSON.stringify(['ArialMT', 'Georgia', 'ArialMT']), '只修改字符 1..3', rangeInspected);
      await run('qa-undo');
      const rangeUndone = await run('qa-inspect');
      check(rangeUndone.fonts.every(font => font === 'ArialMT'), '局部应用撤销恢复', rangeUndone);
      await run('qa-select-all');
      let status = await run('status');
      await run('apply', { font: 'Arial-BoldMT', signature: status.signature });
      status = await run('status');
      const continuous = await run('apply', { font: 'Georgia', signature: status.signature });
      check(continuous.verified && continuous.font === 'Georgia', '连续应用不串用旧字体或旧选区', continuous);
      await run('qa-undo');
      check((await run('qa-inspect')).fonts.every(font => font === 'Arial-BoldMT'), '连续应用后的单次撤销', await run('qa-inspect'));
      await run('qa-deselect');
      const noTarget = await run('apply', { font: 'ArialMT', signature: status.signature });
      check(noTarget.ok === false, '无文本目标拒绝应用', noTarget);
      fs.writeFileSync(path.join(evidence, 'host-results.json'), JSON.stringify({ checks, uiApplied, rangeInspected, continuous, noTarget }, null, 2));
    }
    for (const item of checks) console.log(`${item.result} ${item.label}`);
  } finally { client.close(); clearTimeout(watchdog); }
})().catch(error => { console.error(error.stack); clearTimeout(watchdog); process.exitCode = 1; });
