'use strict';

const { File, fs } = require('/fs.js');
const Core = require('./core.js');

// The local build sets this to the project data directory. Only this directory
// needs file access in Affinity's Scripting settings; no network access is used.
const DATA_PATH = '__FONT_MANAGE_DATA_PATH__';

function readState() {
  try {
    if (!fs.exists(DATA_PATH)) return { state: Core.defaultState(), writable: true, error: '' };
    return { state: Core.normalizeState(JSON.parse(File.readAll(DATA_PATH).toString())), writable: true, error: '' };
  } catch (error) {
    return { state: Core.defaultState(), writable: false, error: `数据未载入，当前仅使用会话数据：${error.message || error}` };
  }
}

function writeState(state) {
  const text = JSON.stringify(Core.normalizeState(state), null, 2);
  const temp = DATA_PATH + '.tmp';
  const file = File.create(temp, 'wb');
  if (!file.isOpen) throw new Error('无法保存收藏，请检查数据目录的脚本访问权限。');
  try {
    file.writeStringAsUtf8(text);
    file.flush();
  } finally { file.close(); }
  // Read back before replacing the previous settings file.
  if (File.readAll(temp).toString() !== text) throw new Error('数据写入不完整，原文件已保留。');
  fs.rename(temp, DATA_PATH);
}

module.exports = { DATA_PATH, readState, writeState };
