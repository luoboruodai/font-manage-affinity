'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { affinityScript } = require('../server/affinity-script.cjs');

function fixture() {
  const logs = [], mutations = [];
  const spread = { isSameNode(other) { return this === other; }, children: { all: { toArray: () => nodes } } };
  function node(key) {
    const value = {
      key, isTextNode: true, isTableTextNode: false, isEditable: true, isLocalEditable: true, isLocked: false,
      parent: spread, isSameNode(other) { return this.key === other.key; },
      currentFont: 'ArialMT'
    };
    value.storyInterface = { story: { text: 'ABC', getGlyphAtts: () => ({ font: { postscriptName: value.currentFont }, height: 40 }) } };
    return value;
  }
  const nodes = [node(1), node(2)];
  let selected = nodes[0];
  const doc = {
    name: 'QA', sessionUuid: 'doc-1', currentSpread: spread,
    selection: null,
    formatText(delta, selection, preview) { mutations.push({ delta, selection, preview }); selected.currentFont = delta.id; }
  };
  function selectionItems() {
    return [{ node: selected, subSelections: [{ ranges: [{ begin: 0, end: 3 }] }] }];
  }
  function updateSelection() {
    const items = selectionItems();
    doc.selection = { items: { filter: fn => ({ toArray: () => items.filter(fn) }), toArray: () => items } };
  }
  updateSelection();
  const modules = {
    '/document.js': { Document: { current: doc }, NewDocumentOptions: {} },
    '/selections.js': {
      Selection: { create: (document, items) => ({ document, items: { toArray: () => Array.isArray(items) ? items : [items] } }) },
      TextSelection: { create: ranges => ranges }
    },
    '/storydelta.js': { StoryDelta: { createPostscriptName: id => ({ id }) } },
    '/storybuilder.js': { StoryBuilder: {} }, '/glyphatts.js': { GlyphAttDoubleType: {} },
    '/nodes.js': { FrameTextNodeDefinition: {} }, '/commands.js': { AddChildNodesCommandBuilder: {} },
    '/fonts.js': { Font: { all: [
      { isValid: true, postscriptName: 'ArialMT', familyName: 'Arial', traitsName: 'Regular' },
      { isValid: true, postscriptName: 'Arial-BoldMT', familyName: 'Arial', traitsName: 'Bold' }
    ] } },
    '/units.js': { UnitType: {} }
  };
  const context = {
    require: id => {
      if (modules[id]) return modules[id];
      if (id === '/application.js') return { Application: { settings: {}, userDesktopPath: '/tmp' } };
      if (id === '/fs.js') return {};
      throw Error('Unexpected module ' + id);
    },
    console: { log: value => logs.push(value), error() {} }, JSON, String, Error, Array, Object
  };
  const hostSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'host.js'), 'utf8');
  function run(action, payload) {
    vm.runInNewContext(affinityScript(hostSource, action, payload), { ...context });
    const line = logs.filter(value => value.startsWith('FONT_MANAGE_RESULT ')).at(-1);
    return JSON.parse(line.slice('FONT_MANAGE_RESULT '.length));
  }
  return { run, mutations, selectSecond: () => { selected = nodes[1]; updateSelection(); } };
}

test('identical text objects have different persistent hierarchy signatures', () => {
  const f = fixture(), first = f.run('status');
  assert.equal(first.ok, true, first.error);
  f.selectSecond();
  const second = f.run('status');
  assert.equal(second.ok, true, second.error);
  assert.notEqual(first.signature, second.signature);
  const rejected = f.run('apply', { font: 'Arial-BoldMT', signature: first.signature });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /选区已变化/);
  assert.equal(f.mutations.length, 0);
});

test('apply validates and verifies the actual target font in one host call', () => {
  const f = fixture(), status = f.run('status');
  assert.equal(status.ok, true, status.error);
  const applied = f.run('apply', { font: 'Arial-BoldMT', signature: status.signature });
  assert.equal(applied.ok, true);
  assert.equal(applied.verified, true);
  assert.equal(applied.font, 'Arial-BoldMT');
  assert.equal(f.mutations.length, 1);
  assert.equal(f.mutations[0].preview, false);
});
