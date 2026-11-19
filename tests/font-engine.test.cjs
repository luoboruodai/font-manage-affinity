'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { inflateSync } = require('node:zlib');

const root = path.join(__dirname, '..');
const stockConfig = path.join(root, 'config', 'coverage.json');
const supportedHost = process.platform === 'darwin';
const preview = (text, options = {}) => ({ op: 'preview', id: 'ArialMT', text, ...options });
let scratch, binary, results;

function run(requests, config) {
  const input = requests.map((request, seq) => JSON.stringify({ ...request, seq })).join('\n') + '\n';
  const lines = execFileSync(binary, config ? [config] : [], {
    cwd: config ? scratch : root,
    encoding: 'utf8',
    input,
    maxBuffer: 32 * 1024 * 1024,
    timeout: 30000
  }).trim().split('\n').map(JSON.parse);
  assert.deepEqual(lines.map(reply => reply.seq), requests.map((_, seq) => seq));
  return lines;
}

before(() => {
  if (!supportedHost) return;
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'font-manage-engine-'));
  binary = path.join(scratch, 'font-engine');
  execFileSync('swiftc', [
    '-O', '-framework', 'AppKit', '-framework', 'CoreText',
    path.join(root, 'native', 'FontEngine.swift'), '-o', binary
  ], { stdio: 'inherit' });
  const requests = {
    catalog: { op: 'fonts' },
    paragraphs: preview('HEAD\nSecond\n\nTAIL'),
    longWord: preview('W'.repeat(70), { width: 160 }),
    chinese: preview('中文字体春夏秋冬'.repeat(7), { id: 'PingFangSC-Regular', width: 150 }),
    korean: preview('가나다라마바사 한글 서울'.repeat(5), { id: 'AppleSDGothicNeo-Regular', width: 150 }),
    fit: preview('MMMMMMMMM', { width: 175, mode: 'fit' }),
    fitAndWrap: preview('W'.repeat(65), { width: 160, mode: 'fit' }),
    allFallback: preview('中😀𠮷\n한글'),
    mixedLines: preview('HEAD\n中😀𠮷\nTAIL'),
    longInput: preview('a'.repeat(497) + '\n𠮷😀한'),
    unknown: preview('ABC', { id: 'Font-Manage-Unavailable-0000' })
  };
  const replies = run(Object.values(requests));
  results = Object.fromEntries(Object.keys(requests).map((key, index) => [key, replies[index]]));
});

after(() => {
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
});

// Count contiguous rows with ink in the actual CoreText PNG, including any
// accidentally drawn system fallback. CoreGraphics emits RGBA, 8 bit PNGs.
function inkBands(result) {
  assert.equal(result.loadError, null);
  assert.equal(result.image, result.png);
  const png = Buffer.from(result.image, 'base64');
  assert.equal(png.readBigUInt64BE(), 0x89504e470d0a1a0an);
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  assert.deepEqual([width, height], [result.width, result.height]);
  assert.deepEqual([png[24], png[25], png[28]], [8, 6, 0]);
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
      chunks.push(png.subarray(offset + 8, offset + 8 + length));
    }
    offset += length + 12;
  }
  const bytes = inflateSync(Buffer.concat(chunks));
  const rowBytes = width * 4;
  assert.equal(bytes.length, height * (rowBytes + 1));
  const previous = Buffer.alloc(rowBytes);
  const current = Buffer.alloc(rowBytes);
  const bands = [];
  for (let y = 0, offset = 0; y < height; y++) {
    const filter = bytes[offset++];
    let opaque = false;
    for (let x = 3; x < rowBytes; x += 4) {
      const left = x >= 4 ? current[x - 4] : 0;
      const top = previous[x];
      const corner = x >= 4 ? previous[x - 4] : 0;
      let prediction = 0;
      if (filter === 1) prediction = left;
      else if (filter === 2) prediction = top;
      else if (filter === 3) prediction = (left + top) >> 1;
      else if (filter === 4) {
        const estimated = left + top - corner;
        const a = Math.abs(estimated - left), b = Math.abs(estimated - top), c = Math.abs(estimated - corner);
        prediction = a <= b && a <= c ? left : b <= c ? top : corner;
      } else assert.equal(filter, 0);
      current[x] = (bytes[offset + x] + prediction) & 255;
      opaque ||= current[x] > 0;
    }
    if (opaque) {
      const latest = bands.at(-1);
      if (latest && latest[1] + 1 === y) latest[1] = y;
      else bands.push([y, y]);
    }
    current.copy(previous);
    offset += rowBytes;
  }
  return bands;
}

test('CoreText catalog separates simplified and traditional coverage with core diagnostics', { skip: !supportedHost }, () => {
  const ids = new Map(results.catalog.fonts.map(face => [face.id, face]));
  const arial = ids.get('ArialMT');
  assert.ok(arial);
  assert.deepEqual(Object.keys(arial.coverage).toSorted(), ['ja', 'ko', 'latin', 'numbers', 'symbols', 'zh-Hans', 'zh-Hant']);
  assert.ok(arial.supports.includes('latin'));
  assert.ok(arial.supports.includes('numbers'));
  assert.ok(arial.languages.includes('digits'));
  for (const key of ['zh-Hans', 'zh-Hant', 'ja', 'ko']) {
    assert.equal(arial.coverage[key].supported, false);
    assert.equal(arial.coverage[key].reason, 'no-coverage');
    assert.equal(arial.coverage[key].coreRatio, 0);
    assert.ok(arial.coverage[key].missingCore.length > 0);
  }
  const simplifiedOnly = ids.get('AlibabaHealthFont20CN-45R');
  const traditionalOnly = ids.get('AppleSDGothicNeo-Regular');
  const panCJK = ids.get('NotoSansCJKsc-Regular');
  assert.equal(simplifiedOnly.coverage['zh-Hans'].supported, true);
  assert.equal(simplifiedOnly.coverage['zh-Hant'].supported, false);
  assert.equal(simplifiedOnly.coverage['zh-Hant'].reason, 'below-core-threshold');
  assert.ok(simplifiedOnly.coverage['zh-Hant'].missingCore.length > 0);
  assert.equal(traditionalOnly.coverage['zh-Hant'].supported, true);
  assert.equal(traditionalOnly.coverage['zh-Hans'].supported, false);
  assert.equal(traditionalOnly.coverage['zh-Hans'].reason, 'below-core-threshold');
  assert.equal(panCJK.coverage['zh-Hans'].supported, true);
  assert.equal(panCJK.coverage['zh-Hant'].supported, true);
  const japanese = ids.get('HiraginoSans-W3');
  const korean = ids.get('AppleSDGothicNeo-Regular');
  assert.equal(japanese.coverage.ja.supported, true);
  assert.equal(korean.coverage.ko.supported, true);
  assert.equal(korean.coverage['zh-Hant'].supported, true);
  const partial = results.catalog.fonts.find(face => {
    const coverage = face.coverage.symbols;
    return coverage.supported && coverage.ratio < 1;
  })?.coverage.symbols;
  assert.ok(partial?.missing.length);
  assert.equal(partial.totalOverall - partial.matchedOverall, partial.missing.length);
});

test('CoreText preserves hard lines, unbroken words, CJK and Hangul in wrapped PNGs', { skip: !supportedHost }, () => {
  const { paragraphs, longWord, chinese, korean } = results;
  assert.deepEqual([paragraphs.mode, paragraphs.fontSize, paragraphs.layoutWidth, paragraphs.width], ['wrap', 32, 480, 960]);
  assert.equal(paragraphs.lineCount, 4);
  const bands = inkBands(paragraphs);
  assert.equal(bands.length, 3);
  assert.ok(bands[2][0] - bands[1][0] > 1.8 * (bands[1][0] - bands[0][0]));
  for (const item of [longWord, chinese, korean]) {
    assert.ok(item.lineCount > 3);
    assert.deepEqual(item.missing, []);
    assert.equal(inkBands(item).length, item.lineCount);
  }
});

test('CoreText fit scales down to one line when possible and wraps at 18 when needed', { skip: !supportedHost }, () => {
  const { fit, fitAndWrap } = results;
  assert.ok(fit.fontSize >= 18 && fit.fontSize < 32);
  assert.equal(fit.lineCount, 1);
  assert.equal(inkBands(fit).length, 1);
  assert.equal(fitAndWrap.fontSize, 18);
  assert.ok(fitAndWrap.lineCount > 1);
  assert.equal(inkBands(fitAndWrap).length, fitAndWrap.lineCount);
});

test('CoreText blocks fallback in every line while preserving missing segments and the 500-grapheme boundary', { skip: !supportedHost }, () => {
  const { allFallback, mixedLines, longInput, unknown } = results;
  assert.equal(allFallback.lineCount, 2);
  assert.deepEqual(allFallback.missing, ['中', '😀', '𠮷', '한', '글']);
  assert.equal(allFallback.fallbackBlocked, true);
  assert.ok(allFallback.fallback.includes('AppleColorEmoji'));
  assert.deepEqual(inkBands(allFallback), []);
  assert.equal(mixedLines.lineCount, 3);
  const bands = inkBands(mixedLines);
  assert.equal(bands.length, 2);
  assert.ok(bands[1][0] - bands[0][1] > 60);
  assert.deepEqual(longInput.missing, ['𠮷', '😀']);
  assert.ok(longInput.lineCount > 10);
  assert.equal(unknown.image, null);
  assert.ok(unknown.loadError);
});

test('CoreText accepts configurable exclusions and partial-coverage thresholds', { skip: !supportedHost }, () => {
  const config = JSON.parse(fs.readFileSync(stockConfig, 'utf8'));
  config.languages.latin.excludePostScript = ['ArialMT'];
  config.languages.symbols.core += '😀';
  config.languages['zh-Hant'].minOverall = 1;
  const override = path.join(scratch, 'coverage-override.json');
  fs.writeFileSync(override, JSON.stringify(config));
  const faces = new Map(run([{ op: 'fonts' }], override)[0].fonts.map(face => [face.id, face]));
  const arial = faces.get('ArialMT');
  assert.equal(arial.coverage.latin.reason, 'excluded-font');
  assert.equal(arial.coverage.latin.coreRatio, 1);
  assert.equal(arial.supports.includes('latin'), false);
  assert.ok(arial.coverage.symbols.missing.includes('😀'));
  assert.equal(faces.get('AppleColorEmoji').coverage.symbols.missing.includes('😀'), false);
  const partial = faces.get('BokutohNStd-Bold').coverage['zh-Hant'];
  assert.equal(partial.supported, true);
  assert.equal(partial.reason, 'partial-coverage');
  assert.deepEqual(partial.missing, ['說']);
});
