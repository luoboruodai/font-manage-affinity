'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('virtual rows keep exact offsets after multiline heights change above the viewport', async () => {
  const { VirtualRows } = await import('../web/model.mjs');
  const layout = new VirtualRows(['a', 'b', 'c', 'd']);
  assert.equal(layout.total, 264);
  assert.equal(layout.offset(3), 198);
  assert.equal(layout.setHeight('a', 260), 194);
  assert.equal(layout.total, 458);
  assert.equal(layout.offset(3), 392);
  assert.equal(layout.setHeight('missing', 500), 0);
  assert.deepEqual(layout.range(300, 120, 0), { start: 1, end: 4 });
});

test('virtual rows stay bounded and ordered for twenty thousand variable rows', async () => {
  const { VirtualRows } = await import('../web/model.mjs');
  const ids = Array.from({ length: 20000 }, (_, index) => 'font-' + index);
  const layout = new VirtualRows(ids);
  for (let index = 0; index < ids.length; index += 97) layout.setHeight(ids[index], 110 + index % 431);
  let previous = 0;
  for (let index = 0; index < ids.length; index++) {
    assert.equal(layout.offset(index), previous);
    previous += layout.height(index);
  }
  assert.equal(layout.total, previous);
  const range = layout.range(layout.total / 2, 700, 3);
  assert.ok(range.start > 0 && range.end > range.start && range.end - range.start < 30);
  assert.ok(layout.offset(range.start) <= layout.total / 2);
});

test('families collapse to one row and default to a screen-readable regular face', async () => {
  const { groupFontFamilies, preferredScreenFace } = await import('../web/model.mjs');
  const faces = [
    { id: 'Demo-Bold', family: 'Demo', style: 'Bold' },
    { id: 'Demo-Italic', family: 'Demo', style: 'Italic' },
    { id: 'Demo-Regular', family: 'Demo', style: 'Regular' },
    { id: 'Demo-Medium', family: 'Demo', style: 'Medium' }
  ];
  const grouped = groupFontFamilies(faces, faces);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].id, 'Demo-Regular');
  assert.equal(grouped[0].familyFaces.length, 4);
  assert.equal(grouped[0].rowKey, 'family:demo');
  assert.equal(preferredScreenFace([
    { id: 'Light', family: 'Fallback', style: 'Light' },
    { id: 'BoldItalic', family: 'Fallback', style: 'Bold Italic' },
    { id: 'Medium', family: 'Fallback', style: 'Medium' },
    { id: 'Condensed', family: 'Fallback', style: 'Condensed Regular' }
  ]).id, 'Medium');
});

test('family choices and exact style searches select the intended PostScript face', async () => {
  const { groupFontFamilies } = await import('../web/model.mjs');
  const faces = [
    { id: 'Demo-Regular', family: 'Demo', style: 'Regular' },
    { id: 'Demo-Bold', family: 'Demo', style: 'Bold' },
    { id: 'Other-Regular', family: 'Other', style: 'Regular' }
  ];
  const selected = groupFontFamilies(faces, faces, { selections: new Map([['demo', 'Demo-Bold']]) });
  assert.equal(selected.find(face => face.familyKey === 'demo').id, 'Demo-Bold');
  const exact = groupFontFamilies([faces[1]], faces);
  assert.equal(exact.length, 1);
  assert.equal(exact[0].id, 'Demo-Bold');
  assert.deepEqual(exact[0].familyFaces.map(face => face.id), ['Demo-Regular', 'Demo-Bold']);
  const switched = groupFontFamilies([faces[1]], faces, { selections: new Map([['demo', 'Demo-Regular']]) });
  assert.equal(switched[0].id, 'Demo-Regular');
});
