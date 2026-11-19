'use strict';
// Run in Affinity's Script Editor. Creates a NEW unsaved test document only.
const { Application } = require('/application.js');
const { Document, NewDocumentOptions } = require('/document.js');
const { Font } = require('/fonts.js');
const { Selection, TextSelection } = require('/selections.js');
const { StoryBuilder } = require('/storybuilder.js');
const { StoryDelta } = require('/storydelta.js');
const { GlyphAttDoubleType } = require('/glyphatts.js');
const { FrameTextNodeDefinition } = require('/nodes.js');
const { AddChildNodesCommandBuilder } = require('/commands.js');
const { UnitType } = require('/units.js');

function main() {
  const report = [];
  let doc;
  function check(value, label) {
    if (!value) throw new Error(label);
    report.push('PASS ' + label);
  }
  try {
    const fonts = Font.all.filter(font => font.isValid && font.postscriptName);
    check(fonts.length > 1, '字体枚举');
    const original = fonts.find(font => font.postscriptName === 'ArialMT') || fonts[0];
    const replacement = fonts.find(font => font.postscriptName === 'Georgia') || fonts.find(font => font.postscriptName !== original.postscriptName);
    const options = NewDocumentOptions.createDefault();
    options.units = UnitType.Pixel;
    options.width = 800; options.height = 400; options.dpi = 72;
    options.pageCount = 1; options.createMaster = false;
    doc = Document.create(options);
    const story = StoryBuilder.create();
    story.setToFrameTextDefaultStyle(doc.dpi, doc.rasterFormat);
    story.applyGlyphDelta(StoryDelta.createPostscriptName(original.postscriptName));
    story.applyGlyphDelta(StoryDelta.createGlyphDouble(GlyphAttDoubleType.Height, 40));
    story.addText('Font Manage ABC 0123');
    const definition = FrameTextNodeDefinition.createFromStoryBuilder({x:40, y:80, width:720, height:220}, story);
    definition.userDescription = 'Font Manage isolated smoke test';
    const builder = AddChildNodesCommandBuilder.create();
    builder.addNode(definition);
    doc.executeCommand(builder.createCommand(true));
    const node = doc.selection.firstNode;
    check(!!node?.isTextNode, '创建独立测试文本对象');
    const content = node.storyInterface.story.text;
    const at = position => node.storyInterface.story.getGlyphAtts(position);
    const initialFont = at(0).font.postscriptName;
    const initialHeight = at(0).height;
    const selection = Selection.create(doc, node);
    const delta = StoryDelta.createPostscriptName(replacement.postscriptName);
    doc.formatText(delta, selection, true);
    check(at(0).font.postscriptName === replacement.postscriptName, '画布字体预览');
    doc.clearPreviews();
    check(at(0).font.postscriptName === initialFont, '取消预览恢复字体');
    doc.formatText(delta, selection, false);
    check(at(0).font.postscriptName === replacement.postscriptName, '应用字体');
    check(at(0).height === initialHeight && node.storyInterface.story.text === content, '保留字号与文字');
    doc.undo();
    check(at(0).font.postscriptName === initialFont, '单次撤销恢复字体');
    const range = Selection.create(doc, node);
    range.addSubSelectionForNode(node, TextSelection.create([{begin:1,end:3}]));
    doc.formatText(delta, range, false);
    check(at(0).font.postscriptName === initialFont && at(1).font.postscriptName === replacement.postscriptName && at(3).font.postscriptName === initialFont, '只修改所选字符范围');
    doc.undo();
    console.log(report.join('\n'));
    Application.alert(report.join('\n') + '\n\n测试文档已保留，原先文档未修改。', 'Font Manage 宿主验证通过');
  } catch (error) {
    if (doc) doc.clearPreviews();
    console.error(report.join('\n') + '\nFAIL ' + (error.message || error));
    Application.alert(report.join('\n') + '\nFAIL ' + (error.message || error), 'Font Manage 宿主验证未通过');
  }
}
module.exports.main = main;
main();
