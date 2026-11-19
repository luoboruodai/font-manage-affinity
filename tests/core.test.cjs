'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  defaultState,
  normalizeState,
  filterFonts,
  toggleFavorite,
  createGroup,
  toggleGroupFont,
  rememberFont,
  importCollections,
  exportCollections,
} = require('../src/core.js');

const fonts = [
  { id: 'SourceSerif-Regular', family: 'Source Serif', style: 'Regular', isSerif: true, isSansSerif: false, isMonospaced: false },
  { id: 'SourceSans-Bold', family: 'Source Sans', style: 'Bold', isSerif: false, isSansSerif: true, isMonospaced: false },
  { id: 'JetBrainsMono-Regular', family: 'JetBrains Mono', style: 'Regular', isSerif: false, isSansSerif: false, isMonospaced: true },
];

test('default state and version validation', () => {
  const initial = defaultState();
  assert.deepEqual(initial, {
    version: 1, favorites: [], groups: [], recent: [],
    previewText: 'Font Manage 字体预览 Aa 0123', previewSize: 32, lastFont: '',
  });
  assert.deepEqual(normalizeState(initial), initial);
  assert.throws(() => normalizeState({ ...initial, version: 2 }), /version/i);
  assert.throws(() => normalizeState({ ...initial, favorites: 'bad' }), /favorites/);
  assert.throws(() => normalizeState({ ...initial, previewSize: 0 }), /preview/);
});

test('search combines multiple case-insensitive terms, kind and scope', () => {
  const state = defaultState();
  toggleFavorite(state, 'SourceSans-Bold');
  const group = createGroup(state, 'Work');
  toggleGroupFont(state, group.id, 'SourceSans-Bold');
  assert.deepEqual(filterFonts(fonts, { query: 'source BOLD', kind: 'sans', scope: 'favorites' }, state).map(font => font.id), ['SourceSans-Bold']);
  assert.deepEqual(filterFonts(fonts, { query: 'SOURCESANS', scope: 'group', groupID: group.id }, state).map(font => font.id), ['SourceSans-Bold']);
  assert.deepEqual(filterFonts(fonts, { query: 'mono regular', kind: 'mono' }, state).map(font => font.id), ['JetBrainsMono-Regular']);
  assert.deepEqual(filterFonts(fonts, { kind: 'serif' }, state).map(font => font.id), ['SourceSerif-Regular']);
});

test('search, sorting and group names work when locale string methods fail', () => {
  const originalCompare = String.prototype.localeCompare;
  const originalLower = String.prototype.toLocaleLowerCase;
  let result;
  try {
    String.prototype.localeCompare = () => { throw new Error('ICU unavailable'); };
    String.prototype.toLocaleLowerCase = () => { throw new Error('ICU unavailable'); };

    const state = defaultState();
    const group = createGroup(state, 'Favorites');
    const duplicateRejected = (() => {
      try { createGroup(state, 'favorites'); return false; }
      catch (error) { return /exists/.test(error.message); }
    })();
    const normalized = normalizeState(state);
    importCollections(state, JSON.stringify({
      version: 1, favorites: [],
      groups: [{ id: 'remote', name: 'FAVORITES', fonts: ['alpha-bold'] }],
    }));
    const ordered = filterFonts([
      { id: 'alpha-regular', family: 'alpha', style: 'Regular' },
      { id: 'alpha-bold', family: 'ALPHA', style: 'Bold' },
      { id: 'beta', family: 'Beta', style: 'Regular' },
    ], { query: 'ALPHA', sort: 'name' }, state).map(font => font.id);
    result = { group, duplicateRejected, normalized, groupFonts: state.groups[0].fonts, ordered };
  } finally {
    String.prototype.localeCompare = originalCompare;
    String.prototype.toLocaleLowerCase = originalLower;
  }
  assert.equal(result.group.name, 'Favorites');
  assert.equal(result.duplicateRejected, true);
  assert.equal(result.normalized.groups[0].name, 'Favorites');
  assert.deepEqual(result.groupFonts, ['alpha-bold']);
  assert.deepEqual(result.ordered, ['alpha-bold', 'alpha-regular']);
});

test('favorites and groups change independently; group names are unique', () => {
  const state = defaultState();
  const group = createGroup(state, '  Clients  ');
  assert.equal(group.name, 'Clients');
  assert.throws(() => createGroup(state, 'clients'), /exists/);
  assert.throws(() => createGroup(state, '  '), /required/);
  toggleFavorite(state, fonts[0].id);
  toggleGroupFont(state, group.id, fonts[1].id);
  assert.deepEqual(state.favorites, [fonts[0].id]);
  assert.deepEqual(group.fonts, [fonts[1].id]);
  toggleFavorite(state, fonts[0].id);
  assert.deepEqual(group.fonts, [fonts[1].id]);
  toggleGroupFont(state, group.id, fonts[1].id);
  assert.deepEqual(group.fonts, []);
});

test('recent fonts stay unique, newest first, and cap at 50', () => {
  const state = defaultState();
  for (let index = 0; index < 52; index++) rememberFont(state, `font-${index}`);
  rememberFont(state, 'font-20');
  assert.equal(state.recent.length, 50);
  assert.equal(state.recent[0], 'font-20');
  assert.equal(state.recent.filter(id => id === 'font-20').length, 1);
  assert.equal(state.lastFont, 'font-20');
  const named = [fonts[0], fonts[1]];
  rememberFont(state, fonts[0].id);
  rememberFont(state, fonts[1].id);
  assert.deepEqual(filterFonts(named, { scope: 'recent', sort: 'recent' }, state).map(font => font.id), [fonts[1].id, fonts[0].id]);
});

test('collection import merges by group name without replacing settings', () => {
  const state = defaultState();
  state.previewText = 'Sample';
  state.previewSize = 48;
  rememberFont(state, 'old-font');
  const existing = createGroup(state, 'Work');
  toggleGroupFont(state, existing.id, 'A');
  toggleFavorite(state, 'A');
  const imported = {
    version: 1,
    favorites: ['A', 'B'],
    groups: [
      { id: 'remote-1', name: 'work', fonts: ['A', 'B'] },
      { id: existing.id, name: 'New', fonts: ['C'] },
    ],
  };
  importCollections(state, JSON.stringify(imported));
  assert.deepEqual(state.favorites, ['A', 'B']);
  assert.deepEqual(state.groups[0], { id: existing.id, name: 'Work', fonts: ['A', 'B'] });
  assert.equal(state.groups[1].name, 'New');
  assert.notEqual(state.groups[1].id, existing.id);
  assert.deepEqual(state.groups[1].fonts, ['C']);
  assert.equal(state.previewText, 'Sample');
  assert.equal(state.previewSize, 48);
  assert.deepEqual(state.recent, ['old-font']);
  assert.equal(state.lastFont, 'old-font');
  assert.deepEqual(Object.keys(JSON.parse(exportCollections(state))), ['version', 'favorites', 'groups']);
});

test('bad import leaves state untouched', () => {
  const state = defaultState();
  toggleFavorite(state, 'A');
  const before = structuredClone(state);
  assert.throws(() => importCollections(state, '{'), SyntaxError);
  assert.deepEqual(state, before);
  assert.throws(() => importCollections(state, JSON.stringify({ version: 2, favorites: [], groups: [] })), /version/i);
  assert.deepEqual(state, before);
  assert.throws(() => importCollections(state, JSON.stringify({ version: 1, favorites: [], groups: [{ id: 'x', name: 'Bad', fonts: null }] })), /group.fonts/);
  assert.deepEqual(state, before);
});
