'use strict';
// Resident Affinity adapter. File access stays inside the existing project data grant.
const Host = require('./host.js');
const { File, fs } = require('/fs.js');
const { setTimeout } = require('/timers.js');
const { Environment } = require('/environment.js');
const { Document } = require('/document.js');
const ROOT = '__FONT_MANAGE_BRIDGE_PATH__';
const session = String(Date.now());
let lastRequest = '', stopped = false, timer, lastStatus = '';
let previousNodes = [], previousDocument = '', previousRanges = '', selectionRevision = 0;
function read(name) { return JSON.parse(File.readAll(ROOT + '/' + name).toString()); }
function write(name, value) {
  const path = ROOT + '/' + name, f = File.create(path + '.tmp', 'wb');
  if (!f.isOpen) throw new Error('无法写入 Font Manage 数据目录');
  try { f.writeStringAsUtf8(JSON.stringify(value)); f.flush(); } finally { f.close(); }
  fs.rename(path + '.tmp', path);
}
function context() {
  const target = Host.captureTarget();
  const document = Document.current?.name || Document.current?.title || '';
  const items = target ? target.selection.items.toArray() : [];
  const targetFonts = items.map(i => i.node.storyInterface.story.getGlyphAtts(i.subSelections.find(s=>s.ranges?.length)?.ranges[0].begin || 0).font.postscriptName);
  const font = targetFonts.length && targetFonts.every(f=>f===targetFonts[0]) ? targetFonts[0] : '';
  const documentID = String(Document.current?.sessionUuid || '');
  const ranges = JSON.stringify(items.map(i=>i.subSelections.map(s=>s.ranges||[])));
  let sameObjects = items.length === previousNodes.length && documentID === previousDocument;
  if (sameObjects) { try { sameObjects=items.every((i,n)=>i.node.isSameNode(previousNodes[n])); } catch { sameObjects=false; } }
  if (!sameObjects || ranges !== previousRanges) selectionRevision++;
  previousNodes=items.map(i=>i.node);previousDocument=documentID;previousRanges=ranges;
  const signature = session + ':' + selectionRevision;
  return { target, document, count: items.length, font, signature };
}
function tick() {
  try {
    const lease = read('workspace-heartbeat.json');
    if (Date.now() - lease.time > 20000) { stopped = true; }
    if (stopped) { write('affinity-status.json', {session, time:Date.now(), connected:false}); Environment.quit(); return; }
    let c = context();
    const status = { session, time:Date.now(), connected:true, document:c.document, count:c.count, font:c.font, signature:c.signature };
    const stateKey = JSON.stringify([c.document,c.count,c.font,c.signature]);
    if (stateKey !== lastStatus || Date.now() % 2000 < 350) { write('affinity-status.json', status); lastStatus=stateKey; }
    if (fs.exists(ROOT + '/affinity-request.json')) {
      const req = read('affinity-request.json');
      if (req.id !== lastRequest && req.session === session && Date.now()-req.time < 8000) {
        lastRequest = req.id;
        try {
          if (req.action === 'apply') {
            if (!c.target) throw new Error('请在 Affinity 中选择文本对象，再返回应用。');
            if (req.signature !== c.signature) throw new Error('Affinity 选区已变化，请确认当前对象后再应用。');
            if (!fonts.some(f => f.id === req.font)) throw new Error('Affinity 中没有这款字体。');
            Host.changeFont(c.target, {id:req.font}, false);
          } else if (req.action === 'stop') { stopped=true; }
          else if (typeof __FONT_MANAGE_QA__ !== 'undefined' && __FONT_MANAGE_QA__) {
            if (req.action === 'qa-undo') c.target.doc.undo();
            else if (req.action === 'qa-deselect') Document.current.selection = null;
            else if (req.action === 'qa-range') { const {Selection,TextSelection}=require('/selections.js'); const s=Selection.create(__fmQADoc,__fmQANode);s.addSubSelectionForNode(__fmQANode,TextSelection.create([{begin:1,end:3}]));__fmQADoc.selection=s; }
            else throw new Error('未知测试操作');
          } else throw new Error('未知操作');
          c=context();
          const qa = typeof __FONT_MANAGE_QA__ !== 'undefined' && __FONT_MANAGE_QA__ ? {text:__fmQANode.storyInterface.story.text,size:__fmQANode.storyInterface.story.getGlyphAtts(0).height,fonts:[0,1,3].map(i=>__fmQANode.storyInterface.story.getGlyphAtts(i).font.postscriptName)} : undefined;
          write('affinity-response.json', {id:req.id,ok:true,font:c.font,count:c.count,qa});
          lastStatus='';
        } catch(error) { write('affinity-response.json', {id:req.id,ok:false,error:String(error.message || error)}); }
      }
    }
  } catch(error) { console.error('Font Manage bridge: '+String(error.message || error));
    if (!fs.exists(ROOT + '/workspace-heartbeat.json')) { Environment.quit(); return; }
  }
  timer = setTimeout(250, error => { if (!error || error.value === 0) tick(); });
}
const fonts = Host.enumerateFonts();
write('affinity-fonts.json', fonts.map(({native,...font}) => font));
console.log('Font Manage 0.2 · Affinity adapter started · '+fonts.length+' fonts');
tick();
