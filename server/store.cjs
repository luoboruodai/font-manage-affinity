'use strict';
const fs=require('node:fs'),path=require('node:path');
const Core=require('../src/core.js');
function atomic(file,value){const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2));fs.renameSync(tmp,file);}
const defaults={language:'latin',kind:'all',sort:'name',customTexts:{},previewCollapsed:false,size:24,affinityAutoLaunch:true};
class Store {
 constructor(dir){
  this.dir=dir;fs.mkdirSync(dir,{recursive:true});this.file=path.join(dir,'font-manage.json');this.settingsFile=path.join(dir,'workspace-settings.json');
  this.state=fs.existsSync(this.file)?Core.normalizeState(JSON.parse(fs.readFileSync(this.file))):Core.defaultState();
  const saved=fs.existsSync(this.settingsFile)?JSON.parse(fs.readFileSync(this.settingsFile)):{};
  this.settings={...defaults,...saved};
  if(this.settings.language==='zh')this.settings.language='zh-Hans';
  if(saved.filterLanguage===false)this.settings.language='all';
  delete this.settings.filterLanguage;delete this.settings.languageFilterVersion;
  if(saved.previewMode==='custom'&&typeof saved.customText==='string'&&saved.customText&&saved.customTexts===undefined)this.settings.customTexts={[this.settings.language]:saved.customText.slice(0,500)};
  delete this.settings.previewMode;delete this.settings.customText;
 }
 snapshot(){return {state:this.state,settings:this.settings};}
 act(a){const s=structuredClone(this.state),u={...this.settings};
  const ids=Array.isArray(a.ids)?[...new Set(a.ids.filter(x=>typeof x==='string'&&x))]:[];
  const group=()=>{const g=s.groups.find(g=>g.id===a.group);if(!g)throw Error('分组已不存在');return g;};
  const name=()=>{const n=String(a.name||'').trim();if(!n)throw Error('请输入分组名称');if(n.length>64)throw Error('分组名称最多64个字符');if(s.groups.some(g=>g.id!==a.group&&g.name.toLowerCase()===n.toLowerCase()))throw Error('已有同名分组');return n;};
  switch(a.type){
   case 'favorite': if(!a.id)throw Error('请选择字体');Core.toggleFavorite(s,a.id);break;
   case 'select': if(a.id)Core.rememberFont(s,a.id);break;
   case 'create':Core.createGroup(s,name());break;
   case 'rename':group().name=name();break;
   case 'delete':group();s.groups=s.groups.filter(g=>g.id!==a.group);break;
   case 'add':group().fonts=[...new Set([...group().fonts,...ids])];break;
   case 'remove':group().fonts=group().fonts.filter(id=>!ids.includes(id));break;
   case 'settings':{Object.assign(u,a.settings);u.size=Math.max(20,Math.min(52,Number(u.size)||24));u.previewCollapsed=!!u.previewCollapsed;const texts={};if(u.customTexts&&typeof u.customTexts==='object')for(const [key,value] of Object.entries(u.customTexts)){const text=String(value).slice(0,500);if(text.trim()&&Object.keys(texts).length<32)texts[String(key).slice(0,32)]=text;}u.customTexts=texts;delete u.previewMode;delete u.customText;delete u.filterLanguage;delete u.languageFilterVersion;break;}
   case 'import':Core.importCollections(s,a.json);break;
   default:throw Error('未知操作');
  }
  if(a.type==='settings')atomic(this.settingsFile,u);else atomic(this.file,Core.normalizeState(s));
  this.state=s;this.settings=u;return this.snapshot();
 }
}
module.exports={Store,atomic};
