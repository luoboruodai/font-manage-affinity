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
