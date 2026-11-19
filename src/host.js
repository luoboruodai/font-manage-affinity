'use strict';

const { Document, NewDocumentOptions } = require('/document.js');
const { Selection } = require('/selections.js');
const { StoryDelta } = require('/storydelta.js');
const { StoryBuilder } = require('/storybuilder.js');
const { GlyphAttDoubleType } = require('/glyphatts.js');
const { FrameTextNodeDefinition } = require('/nodes.js');
const { AddChildNodesCommandBuilder } = require('/commands.js');
const { Font } = require('/fonts.js');
const { UnitType } = require('/units.js');

function enumerateFonts() {
  const seen = new Set();
  return Font.all.filter(font => {
    if (!font.isValid || !font.postscriptName || seen.has(font.postscriptName)) return false;
    seen.add(font.postscriptName);
    return true;
  }).map(font => ({
    id: font.postscriptName,
    family: font.familyName,
    style: font.traitsName || 'Regular',
    isSerif: font.isSerif,
    isSansSerif: font.isSansSerif,
    isMonospaced: font.isMonospaced,
    native: font,
  }));
}

function captureTarget() {
  const doc = Document.current;
  if (!doc) return null;
  // Keep selection items (including character ranges), not just their nodes.
  const items = doc.selection.items.filter(item => item.node?.isTextNode && !item.node.isTableTextNode).toArray();
  if (!items.length) return null;
  const selection = Selection.create(doc, items);
  return { doc, selection, count: items.length };
}

function changeFont(target, record, preview) {
  if (!target || !record) throw new Error('请先选择艺术字或文本框。');
  target.doc.formatText(StoryDelta.createPostscriptName(record.id), target.selection, preview);
}

function makeSpecimen(records, text, size) {
  if (!records.length) throw new Error('当前筛选没有字体。');
  const list = records.slice(0, 6);
  const options = NewDocumentOptions.createDefault();
  options.units = UnitType.Pixel;
  options.dpi = 72;
  options.width = 1000;
  options.height = 140 + list.length * 145;
  options.pageCount = 1;
  options.createMaster = false;
  const doc = Document.create(options);
  const builder = AddChildNodesCommandBuilder.create();
  function addText(value, fontID, height, y, boxHeight) {
    const story = StoryBuilder.create();
    story.setToFrameTextDefaultStyle(doc.dpi, doc.rasterFormat);
    story.applyGlyphDelta(StoryDelta.createGlyphDouble(GlyphAttDoubleType.Height, height));
    if (fontID) story.applyGlyphDelta(StoryDelta.createPostscriptName(fontID));
    story.addText(value);
    const def = FrameTextNodeDefinition.createFromStoryBuilder({ x: 48, y, width: 904, height: boxHeight }, story);
    def.userDescription = value.slice(0, 80);
    builder.addNode(def);
  }
  addText('Font Manage · 字体对照', null, 24, 30, 50);
  list.forEach((font, i) => {
    addText(`${i + 1}   ${font.family} / ${font.style}`, null, 14, 100 + 145 * i, 28);
    addText(text || 'Aa 0123', font.id, size, 132 + 145 * i, 100);
  });
  doc.executeCommand(builder.createCommand(false));
  return doc;
}

module.exports = { enumerateFonts, captureTarget, changeFont, makeSpecimen };
