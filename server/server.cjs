'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process'), readline = require('node:readline');
const { Store, atomic } = require('./store.cjs');
const { AffinityHost } = require('./affinity-host.cjs');

const ROOT = path.resolve(__dirname, '..'), DATA = process.env.FONT_MANAGE_DATA || path.join(ROOT, 'data');
const HOST_ENABLED = process.env.FONT_MANAGE_DISABLE_HOST !== '1';
const store = new Store(DATA);
const affinity = new AffinityHost({ root: ROOT, dataDir: DATA, getSettings: () => store.settings });
const engine = spawn(path.join(ROOT, 'dist', 'font-engine'), [], { stdio: ['pipe', 'pipe', 'pipe'] });
let seq = 0;
const pending = new Map();
readline.createInterface({ input: engine.stdout }).on('line', line => {
  try {
    const result = JSON.parse(line), item = pending.get(result.seq);
    if (item) {
      pending.delete(result.seq);
      result.error ? item.reject(Error(result.error)) : item.resolve(result);
    }
  } catch (error) { console.error(error.message); }
});
engine.stderr.on('data', buffer => process.stderr.write(buffer));
engine.on('exit', () => {
  for (const item of pending.values()) item.reject(Error('字体引擎已退出，请重新启动 Font Manage'));
  pending.clear();
});
function native(op) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    engine.stdin.write(JSON.stringify({ ...op, seq: id }) + '\n');
  });
}
const fontPromise = native({ op: 'fonts' }).then(result => result.fonts);
const cache = new Map();
let cacheBytes = 0, hits = 0;
function json(res, value, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function body(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 1000000) throw Error('数据过大');
  }
  return JSON.parse(text || '{}');
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.headers.origin && req.headers.origin !== `http://127.0.0.1:${server.address().port}`) {
      return json(res, { error: 'Origin refused' }, 403);
    }
    if (url.pathname === '/api/bootstrap') {
      return json(res, { ...store.snapshot(), fonts: await fontPromise, host: affinity.snapshot(), affinityIDs: affinity.affinityIDs });
    }
    if (url.pathname === '/api/diagnostics') {
      const language = String(url.searchParams.get('language') || 'all');
      const only = String(url.searchParams.get('only') || 'excluded');
      const diagnostics = (await fontPromise)
        .map(face => ({ font: face.id, language, ...face.coverage?.[language] }))
        .filter(face => face.reason && (only === 'all' || (only === 'excluded' && !face.supported) || (only === 'partial' && face.supported && (face.ratio < 1 || face.missing?.length))));
      return json(res, { language, only, diagnostics });
    }
    if (url.pathname === '/api/host') return json(res, affinity.snapshot());
    if (url.pathname === '/api/state' && req.method === 'POST') {
      const action = await body(req), result = store.act(action);
      if (HOST_ENABLED && action.type === 'settings' && Object.hasOwn(action.settings, 'affinityAutoLaunch')) affinity.schedule(0);
      return json(res, result);
    }
    if (url.pathname === '/api/apply' && req.method === 'POST') {
      const input = await body(req);
      return json(res, await affinity.apply(String(input.font || ''), String(input.signature || '')));
    }
    if (url.pathname === '/api/reconnect' && req.method === 'POST') {
      if (HOST_ENABLED) await affinity.reconnect();
      return json(res, affinity.snapshot());
    }
    if (url.pathname === '/api/focus-affinity' && req.method === 'POST') {
      if (HOST_ENABLED) await affinity.focus();
      return json(res, { ok: true });
    }
    if (url.pathname === '/api/qa' && process.env.FONT_MANAGE_QA === '1' && req.method === 'POST') {
      const input = await body(req);
      return json(res, await affinity.execute(input.action, input));
    }
    if (url.pathname === '/api/export' && req.method === 'POST') {
      const file = path.join(DATA, 'Font Manage collections.json');
      atomic(file, { version: 1, favorites: store.state.favorites, groups: store.state.groups });
      return json(res, { file });
    }
    if (url.pathname === '/api/preview') {
      const query = {
        op: 'preview', id: url.searchParams.get('id'),
        text: (url.searchParams.get('text') || '').slice(0, 500),
        size: Math.max(20, Math.min(52, Number(url.searchParams.get('size')) || 32)),
        width: Math.max(160, Math.min(1400, Number(url.searchParams.get('width')) || 600)),
        scale: 2, mode: 'fit'
      };
      const key = JSON.stringify(query);
      let result = cache.get(key);
      if (result) {
        hits++;
        cache.delete(key);
        cache.set(key, result);
      } else {
        result = await native(query);
        cache.set(key, result);
        cacheBytes += result.png?.length || 0;
        while (cache.size > 96 || cacheBytes > 24 * 1024 * 1024) {
          const oldest = cache.keys().next().value;
          if (oldest === undefined) break;
          cacheBytes -= cache.get(oldest).png?.length || 0;
          cache.delete(oldest);
        }
      }
      return json(res, result);
    }
    if (url.pathname === '/api/metrics') {
      return json(res, { rss: process.memoryUsage().rss, previewCache: cache.size, cacheBytes, hits, pending: pending.size, fontCount: (await fontPromise).length });
    }
    const files = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/model.mjs': 'model.mjs' };
    const name = files[url.pathname];
    if (!name) { res.writeHead(404); return res.end(); }
    res.writeHead(200, {
      'Content-Type': name.endsWith('.css') ? 'text/css' : (name.endsWith('.js') || name.endsWith('.mjs')) ? 'text/javascript' : 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'"
    });
    res.end(fs.readFileSync(path.join(ROOT, 'web', name)));
  } catch (error) { json(res, { error: error.message }, 400); }
});
server.listen(Number(process.env.FONT_MANAGE_PORT) || 0, '127.0.0.1', () => {
  if (process.env.FONT_MANAGE_DISABLE_HOST !== '1') affinity.start();
  console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`, pid: process.pid }));
});
function stop() {
  affinity.stop();
  engine.kill();
  server.close();
  process.exit();
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
