'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Readable } = require('node:stream');
const { AffinityMCP, DEFAULT_URL, PROTOCOL_VERSION, toolText } = require('../server/affinity-mcp.cjs');

function fakeServer(t) {
  const sockets = new Set(), calls = [];
  const server = http.createServer((req, res) => {
    if (req.url === '/sse') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('event: endpoint\r\ndata: /message?session_id=qa\r\n\r\n');
      res.write('event: heartbeat\r\ndata: {}\r\n\r\n');
      return;
    }
    let text = '';
    req.on('data', chunk => { text += chunk; });
    req.on('end', () => {
      const message = JSON.parse(text);
      calls.push(message);
      res.writeHead(202).end();
      if (message.id === undefined) return;
      const result = message.method === 'initialize' ? { protocolVersion: PROTOCOL_VERSION } :
        message.method === 'tools/list' ? { tools: [{ name: 'execute_script' }] } :
        message.method === 'tools/call' ? { content: [{ type: 'text', text: 'ok' }] } : {};
      const stream = server.sse;
      if (stream) stream.write(`event: message\r\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\r\n\r\n`);
    });
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('request', (req, res) => { if (req.url === '/sse') server.sse = res; });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      t.after(() => { for (const socket of sockets) socket.destroy(); server.close(); });
      resolve({ server, calls, url: `http://127.0.0.1:${server.address().port}/sse` });
    });
  });
}

test('SSE endpoint discovery, fragmented input and heartbeat are parsed without treating them as messages', async () => {
  const client = new AffinityMCP();
  let resolveEndpoint;
  const found = new Promise(resolve => { resolveEndpoint = resolve; });
  const chunks = ['event: endpoint\r', '\ndata: /message?session_id=x\r', '\n\r', '\nevent: heartbeat\r\ndata: {}\r\n\r\n'];
  await client.consume(Readable.toWeb(Readable.from(chunks.map(Buffer.from))), resolveEndpoint);
  assert.equal((await found).pathname, '/message');
  assert.equal(client.ready, false);
});

test('client performs the required handshake and calls a tool over the session endpoint', async t => {
  const fake = await fakeServer(t);
  const client = new AffinityMCP({ url: fake.url, requestTimeout: 2000 });
  t.after(() => client.close());
  assert.deepEqual(await client.connect(), ['execute_script']);
  assert.equal(toolText(await client.callTool('execute_script', { script: 'console.log(1)' })), 'ok');
  assert.equal(fake.calls[0].method, 'initialize');
  assert.equal(fake.calls[0].params.protocolVersion, PROTOCOL_VERSION);
  assert.equal(fake.calls[1].method, 'notifications/initialized');
  assert.equal(fake.calls[2].method, 'tools/list');
  assert.equal(fake.calls[3].params.name, 'execute_script');
});

test('default endpoint uses the IPv4 loopback exposed by Affinity', () => {
  assert.equal(DEFAULT_URL, 'http://127.0.0.1:6767/sse');
});

test('non-loopback endpoints are refused before any network access', () => {
  assert.throws(() => new AffinityMCP({ url: 'https://example.com/sse' }), /仅允许本机地址/);
});
