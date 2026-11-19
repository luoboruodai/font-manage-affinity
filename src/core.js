'use strict';

const VERSION = 1;
const PREVIEW_TEXT = 'Font Manage 字体预览 Aa 0123';
const RECENT_LIMIT = 50;

function defaultState() {
  return {
    version: VERSION,
    favorites: [],
    groups: [],
    recent: [],
    previewText: PREVIEW_TEXT,
    previewSize: 32,
    lastFont: '',
  };
}

function stringArray(value, field) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new TypeError(`${field} must be an array of nonempty strings`);
  }
  return [...value];
}

function validatedCollections(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('State must be an object');
  }
  if (raw.version !== VERSION) {
    throw new Error(`Unsupported state version: ${raw.version}`);
  }
  const favorites = stringArray(raw.favorites, 'favorites');
  if (!Array.isArray(raw.groups)) {
    throw new TypeError('groups must be an array');
  }
  const ids = new Set();
  const names = new Set();
  const groups = raw.groups.map(group => {
    if (!group || typeof group !== 'object' || Array.isArray(group) ||
        typeof group.id !== 'string' || !group.id.trim() ||
        typeof group.name !== 'string' || !group.name.trim()) {
      throw new TypeError('Invalid group');
    }
    const name = group.name.trim();
    const nameKey = name.toLowerCase();
    if (ids.has(group.id) || names.has(nameKey)) {
      throw new Error('Duplicate group ID or name');
    }
    ids.add(group.id);
    names.add(nameKey);
    return { id: group.id, name, fonts: stringArray(group.fonts, 'group.fonts') };
  });
  return { favorites, groups };
}

function normalizeState(raw) {
  const { favorites, groups } = validatedCollections(raw);
  const recent = stringArray(raw.recent, 'recent');
  if (typeof raw.previewText !== 'string' ||
      typeof raw.previewSize !== 'number' || !Number.isFinite(raw.previewSize) || raw.previewSize <= 0 ||
      typeof raw.lastFont !== 'string') {
    throw new TypeError('Invalid preview or last font settings');
  }
  return {
    version: VERSION,
    favorites: [...new Set(favorites)],
    groups: groups.map(group => ({ ...group, fonts: [...new Set(group.fonts)] })),
    recent: [...new Set(recent)].slice(0, RECENT_LIMIT),
    previewText: raw.previewText,
    previewSize: raw.previewSize,
    lastFont: raw.lastFont,
  };
}

function filterFonts(fontRecords, options = {}, state = defaultState()) {
  const { query = '', scope = 'all', groupID = '', kind = 'all', sort = 'name' } = options;
  const terms = String(query).toLowerCase().trim().split(/\s+/).filter(Boolean);
  const favorites = new Set(state.favorites);
  const recent = new Map(state.recent.map((id, index) => [id, index]));
  const group = state.groups.find(item => item.id === groupID);
  const groupFonts = new Set(group ? group.fonts : []);
  const result = fontRecords.filter(font => {
    if (scope === 'favorites' && !favorites.has(font.id)) return false;
    if (scope === 'recent' && !recent.has(font.id)) return false;
    if (scope === 'group' && !groupFonts.has(font.id)) return false;
    if (kind === 'serif' && !font.isSerif) return false;
    if (kind === 'sans' && !font.isSansSerif) return false;
    if (kind === 'mono' && !font.isMonospaced) return false;
    const haystack = `${font.family || ''} ${font.style || ''} ${font.id || ''}`.toLowerCase();
    return terms.every(term => haystack.includes(term));
  });
  const compareText = (left, right) => {
    const a = String(left).toLowerCase();
    const b = String(right).toLowerCase();
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  };
  const byName = (a, b) => {
    const fields = ['family', 'style', 'id'];
    for (const field of fields) {
      const order = compareText(a[field], b[field]);
      if (order) return order;
    }
    for (const field of fields) {
      const left = String(a[field]);
      const right = String(b[field]);
      if (left < right) return -1;
      if (left > right) return 1;
    }
    return 0;
  };
  result.sort((a, b) => {
    if (sort === 'recent') {
      const aRank = recent.get(a.id) ?? Infinity;
      const bRank = recent.get(b.id) ?? Infinity;
      if (aRank !== bRank) return aRank - bRank;
    }
    return byName(a, b);
  });
  return result;
}

function toggleFavorite(state, id) {
  const index = state.favorites.indexOf(id);
  if (index < 0) state.favorites.push(id);
  else state.favorites.splice(index, 1);
  return state;
}

function nextGroupID(groups) {
  const ids = new Set(groups.map(group => group.id));
  let index = 1;
  while (ids.has(`group-${index}`)) index++;
  return `group-${index}`;
}

function createGroup(state, name) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('Group name is required');
  const trimmed = name.trim();
  if (state.groups.some(group => group.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error('Group name already exists');
  }
  const group = { id: nextGroupID(state.groups), name: trimmed, fonts: [] };
  state.groups.push(group);
  return group;
}

function toggleGroupFont(state, groupID, fontID) {
  const group = state.groups.find(item => item.id === groupID);
  if (!group) throw new Error(`Unknown group: ${groupID}`);
  const index = group.fonts.indexOf(fontID);
  if (index < 0) group.fonts.push(fontID);
  else group.fonts.splice(index, 1);
  return state;
}

function rememberFont(state, id) {
  state.recent = [id, ...state.recent.filter(item => item !== id)].slice(0, RECENT_LIMIT);
  state.lastFont = id;
  return state;
}

function importCollections(state, json) {
  const incoming = validatedCollections(JSON.parse(json));
  const favorites = [...new Set([...state.favorites, ...incoming.favorites])];
  const groups = state.groups.map(group => ({ ...group, fonts: [...group.fonts] }));
  for (const imported of incoming.groups) {
    const existing = groups.find(group => group.name.toLowerCase() === imported.name.toLowerCase());
    if (existing) {
      existing.fonts = [...new Set([...existing.fonts, ...imported.fonts])];
    } else {
      const id = groups.some(group => group.id === imported.id) ? nextGroupID(groups) : imported.id;
      groups.push({ id, name: imported.name, fonts: [...new Set(imported.fonts)] });
    }
  }
  state.favorites = favorites;
  state.groups = groups;
  return state;
}

function exportCollections(state) {
  const { favorites, groups } = validatedCollections(state);
  return JSON.stringify({ version: VERSION, favorites, groups });
}

module.exports = {
  defaultState,
  normalizeState,
  filterFonts,
  toggleFavorite,
  createGroup,
  toggleGroupFont,
  rememberFont,
  importCollections,
  exportCollections,
};
