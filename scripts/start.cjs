'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const readline = require('node:readline');

const root = path.resolve(__dirname, '..');
const windowBinary = path.join(root, 'dist', 'font-workspace');
const dataDir = process.env.FONT_MANAGE_DATA || path.join(root, 'data');
if (!fs.existsSync(windowBinary) || !fs.existsSync(path.join(root, 'dist', 'font-engine'))) {
  console.error('请先构建 Font Manage：node scripts/build-workspace.cjs');
  process.exit(1);
}
fs.mkdirSync(dataDir, { recursive: true });
const lockFile = path.join(dataDir, 'workspace.lock');
let lockFD;
function running(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
function reuseExisting() {
  try {
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    if (!running(lock.pid)) return false;
    try { execFileSync('/usr/bin/open', ['-b', 'local.fontmanage.workspace'], { stdio: 'ignore' }); } catch {}
    return true;
  } catch {
    try { fs.unlinkSync(lockFile); } catch {}
    return false;
  }
}
for (let attempt = 0; attempt < 2 && lockFD === undefined; attempt++) {
  try {
    lockFD = fs.openSync(lockFile, 'wx', 0o600);
    fs.writeFileSync(lockFD, JSON.stringify({ pid: process.pid, url: '' }));
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (reuseExisting()) break;
  }
}
if (lockFD === undefined) process.exit(0);
function unlock() {
  try {
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    if (lock.pid === process.pid) fs.unlinkSync(lockFile);
  } catch {}
  if (lockFD !== undefined) fs.closeSync(lockFD);
  lockFD = undefined;
}
const server = spawn(process.execPath, [path.join(root, 'server', 'server.cjs')], {
  cwd: root,
  env: { ...process.env, FONT_MANAGE_DATA: dataDir },
  stdio: ['ignore', 'pipe', 'inherit']
});
let window, stopping = false;
function stop(code, message) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  clearTimeout(startup);
  if (message) console.error(message);
  if (window?.exitCode === null && window.signalCode === null) window.kill();
  if (server.exitCode === null && server.signalCode === null) server.kill();
  unlock();
}
const startup = setTimeout(() => stop(1, 'Font Manage 本地服务启动超时。'), 15000);
server.on('error', error => stop(1, error.message));
server.on('exit', () => stop(1, 'Font Manage 本地服务已经退出。'));
readline.createInterface({ input: server.stdout }).once('line', line => {
  if (stopping) return;
  clearTimeout(startup);
  try {
    const ready = JSON.parse(line), url = new URL(ready.url);
    if (ready.pid !== server.pid || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
        !url.port || url.username || url.password) throw Error('启动响应不是本机服务地址。');
    fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, url: url.href }));
    window = spawn(windowBinary, [url.href], { cwd: root, stdio: 'inherit' });
    window.on('error', error => stop(1, error.message));
    window.on('exit', (code, signal) => stop(code ?? (signal ? 1 : 0)));
  } catch (error) { stop(1, error.message); }
});
process.on('exit', unlock);
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
