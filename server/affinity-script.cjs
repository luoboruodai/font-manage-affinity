'use strict';

function affinityScript(hostSource, action, payload = {}) {
  return `
const Host = (() => { const module = { exports: {} };
${hostSource}
return module.exports; })();
const { Document } = require('/document.js');
const { Selection, TextSelection } = require('/selections.js');
const action = ${JSON.stringify(action)};
const request = ${JSON.stringify(payload)};
function nodePath(node, doc) {
  const parts = [];
  let current = node;
  while (current && !current.isSameNode(doc.currentSpread)) {
    const parent = current.parent;
    if (!parent) return 'unrooted';
    const siblings = parent.children.all.toArray();
    const index = siblings.findIndex(item => item.isSameNode(current));
    if (index < 0) return 'detached';
    parts.unshift(index);
    current = parent;
  }
  return parts.join('.');
}
function capture() {
  const doc = Document.current;
  const target = Host.captureTarget();
  const items = target ? target.selection.items.toArray() : [];
  const paths = items.map(item => nodePath(item.node, doc));
  const ranges = items.map(item => item.subSelections.map(sub => sub.ranges || []));
  const targetFonts = items.map(item => item.node.storyInterface.story.getGlyphAtts(
    item.subSelections.find(sub => sub.ranges?.length)?.ranges[0].begin || 0
  ).font.postscriptName);
  const font = targetFonts.length && targetFonts.every(value => value === targetFonts[0]) ? targetFonts[0] : '';
  const editable = items.length > 0 && items.every(item =>
    item.node.isEditable !== false && item.node.isLocalEditable !== false && item.node.isLocked !== true);
  return {
    target, document: doc?.name || doc?.title || '', documentId: String(doc?.sessionUuid || ''),
    count: items.length, font, editable, paths, ranges,
    signature: JSON.stringify({ documentId: String(doc?.sessionUuid || ''), paths, ranges })
  };
}
function reply(c, extra = {}) {
  const value = {
    ok: true, document: c.document, documentId: c.documentId, count: c.count,
    font: c.font, editable: c.editable, signature: c.signature, ...extra
  };
  console.log('FONT_MANAGE_RESULT ' + JSON.stringify(value));
}
function fail(error) {
  console.log('FONT_MANAGE_RESULT ' + JSON.stringify({ ok: false, error: String(error.message || error) }));
}
try {
  let c = capture();
  if (action === 'status') {
    const fonts = request.includeFonts ? Host.enumerateFonts().map(({ native, ...font }) => font) : undefined;
    reply(c, { fonts });
  } else if (action === 'apply') {
    if (!c.target) throw new Error('请在 Affinity 中选择可编辑文本对象。');
    if (!c.editable) throw new Error('当前文本对象已锁定或不可编辑。');
    if (request.signature !== c.signature) throw new Error('Affinity 选区已变化，请确认当前对象后再应用。');
    if (!Host.enumerateFonts().some(font => font.id === request.font)) throw new Error('Affinity 中没有这款字体。');
    const before = c.font;
    Host.changeFont(c.target, { id: request.font }, false);
    c = capture();
    reply(c, { applied: true, verified: c.font === request.font, before, requested: request.font });
  } else if (action === 'qa-undo') {
    if (!c.target) throw new Error('没有可撤销的测试目标。');
    c.target.doc.undo();
    reply(capture(), { undone: true });
  } else if (action === 'qa-deselect') {
    if (Document.current) Document.current.selection = null;
    reply(capture());
  } else if (action === 'qa-select-all') {
    if (!c.target) throw new Error('没有测试文本对象。');
    const item = c.target.selection.items.toArray()[0];
    c.target.doc.selection = Selection.create(c.target.doc, item.node);
    reply(capture());
  } else if (action === 'qa-range') {
    if (!c.target) throw new Error('没有测试文本对象。');
    const item = c.target.selection.items.toArray()[0];
    const selection = Selection.create(c.target.doc, item.node);
    selection.addSubSelectionForNode(item.node, TextSelection.create([{ begin: 1, end: 3 }]));
    c.target.doc.selection = selection;
    reply(capture());
  } else if (action === 'qa-create') {
    const doc = Host.makeSpecimen([{ id: 'ArialMT', family: 'Arial', style: 'Regular' }], 'ABCD', 40);
    const nodes = doc.currentSpread.children.all.toArray();
    const node = nodes.find(item => item.isTextNode && item.storyInterface.story.text === 'ABCD');
    if (!node) throw new Error('没有创建测试文本。');
    doc.selection = Selection.create(doc, node);
    reply(capture(), { created: true });
  } else if (action === 'qa-inspect') {
    if (!c.target) throw new Error('没有测试文本对象。');
    const story = c.target.selection.items.toArray()[0].node.storyInterface.story;
    reply(c, { text: story.text, size: story.getGlyphAtts(0).height,
      fonts: [0, 1, 3].map(index => story.getGlyphAtts(index).font.postscriptName) });
  } else if (action === 'permissions') {
    const { Application } = require('/application.js');
    const fs = require('/fs.js');
    let filesystem = 'enabled', network = 'enabled';
    try { fs.exists(Application.userDesktopPath); } catch (error) { filesystem = String(error.message || error); }
    try {
      const { HttpRequest, RequestMethod } = require('/network.js');
      const probe = HttpRequest.create('http://127.0.0.1:1/', RequestMethod.Get);
      probe.setTimeoutInSec(1);
      probe.do();
    } catch (error) { network = String(error.message || error); }
    reply(c, { allowCodeGenerationFromStrings: Application.settings.allowCodeGenerationFromStrings, filesystem, network });
  } else {
    throw new Error('未知 Font Manage 宿主操作');
  }
} catch (error) { fail(error); }
`;
}

module.exports = { affinityScript };
