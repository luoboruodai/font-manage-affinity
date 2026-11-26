import {samples,filterFonts,groupFontFamilies,fontFamilyKey,VirtualRows} from './model.mjs';
const $=s=>document.querySelector(s),el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const paths={plus:'M12 5v14M5 12h14',star:'m12 3 2.8 5.7 6.3.9-4.5 4.4 1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z',search:'m20 20-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',settings:'M4 7h16M4 17h16M8 4v6M16 14v6',close:'m6 6 12 12M6 18 18 6',rename:'m4 16 12-12 4 4L8 20H4Zm10-10 4 4',trash:'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',reset:'M4 10a8 8 0 1 1 1 8M4 3v7h7',folder:'M3 7h7l2-3h8v16H3Z',check:'m4 12 5 5L20 6',filter:'M4 5h16l-6.2 7.2V19l-3.6 1.8v-8.6L4 5Z','chevron-down':'m6 9 6 6 6-6','chevron-up':'m6 15 6-6 6 6',text:'M5 7V4h14v3M12 4v16M9 20h6',type:'M4 17 7.6 6h1.1L12.3 17M5.4 13h5.5M15 17v-4.4a2.3 2.3 0 0 1 4.6 0V17m0-2.4h-3.8',clear:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM9 9l6 6M15 9l-6 6',info:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7.2v.4M12 11v5.6'};
const LANGS=[['all','全部文字'],['latin','西文'],['zh-Hans','简体中文'],['zh-Hant','繁体中文'],['ja','日文'],['ko','韩文'],['digits','数字'],['symbols','符号']];
function icon(name){const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('aria-hidden','true');const p=document.createElementNS(s.namespaceURI,'path');p.setAttribute('d',paths[name]);s.append(p);return s;}
for(const [value,label] of LANGS){const o=el('option','',label);o.value=value;$('#language').append(o);}
$('#message-icon').append(icon('info'));
for(const [id,name] of Object.entries({'settings':'settings','search-icon':'search','new-group':'plus','rename-group':'rename','delete-group':'trash','cancel-group':'close','kind-icon':'filter','collapsed-icon':'text','reset-preview':'reset'}))$('#'+id).append(icon(name));
let state,settings,fonts=[],host={},affinityIDs=new Set(),results=[],current='',chosen=new Set(),anchor='',scope='all',group='',rowMap=new Map(),positions=new Map(),contextKey='',editingGroup='',messageTimer,saveTimer,renderFrame=0,resizeFrame=0,rowSequence=0;
const familyChoices=new Map(),rowKey=f=>f.rowKey||f.id;
let layout=new VirtualRows([]);const measured=new Map();
const list=$('#font-list'),rows=$('#rows'),ROW=80,GAP=8;
const metrics={renders:0,maxRows:0,previewRequests:0,previewResponses:0};
async function api(url,body){const r=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);const d=await r.json();if(!r.ok||d.error)throw Error(d.error||'读取失败');return d;}
function message(text,error=false){clearTimeout(messageTimer);$('#message-text').textContent=text;$('#message').className=error?'error':'';$('#message').hidden=false;messageTimer=setTimeout(()=>$('#message').hidden=true,error?8000:2600);}
let actionQueue=Promise.resolve();
function mutate(action,refresh=true){const job=actionQueue.then(()=>api('/api/state',action)).then(d=>{state=d.state;if(refresh){refreshGroups();refilter(false);updateFooter();}return d;});actionQueue=job.catch(e=>message(e.message,true));return job;}
const previewText=()=>{const custom=settings.customTexts?.[settings.language];return custom||samples[settings.language]||samples.latin;};
function saveSettings(patch){Object.assign(settings,patch);clearTimeout(saveTimer);const snapshot={...settings};saveTimer=setTimeout(()=>mutate({type:'settings',settings:snapshot},false),180);}
function setCustomText(value){const texts={...settings.customTexts};if(value.trim())texts[settings.language]=value;else delete texts[settings.language];saveSettings({customTexts:texts});}
function applyPreviewCollapse(){const collapsed=!!settings.previewCollapsed;$('#preview-box').hidden=collapsed;$('#language').hidden=collapsed;$('#reset-preview').hidden=collapsed;$('#preview-collapsed').hidden=!collapsed;const toggle=$('#collapse-preview');toggle.setAttribute('aria-expanded',String(!collapsed));toggle.setAttribute('aria-label',collapsed?'展开预览栏':'折叠预览栏');toggle.title=collapsed?'展开预览栏':'折叠预览栏（不隐藏字体列表）';toggle.replaceChildren(icon(collapsed?'chevron-down':'chevron-up'));if(collapsed){$('#collapsed-text').textContent=previewText();$('#collapsed-lang').textContent=LANGS.find(([value])=>value===settings.language)?.[1]||'';}}
function options(){return {query:$('#search').value,scope,group,kind:$('#kind').value,language:settings.language,sort:$('#sort').value};}
function refilter(restore=true){
 if(contextKey)positions.set(contextKey,list.scrollTop);
 const o=options();contextKey=JSON.stringify(o);const matching=filterFonts(fonts,state,o);results=groupFontFamilies(matching,fonts,{preferredID:host.font||'',selections:familyChoices});layout=new VirtualRows(results.map(rowKey),ROW);
 for(const f of results){const height=measured.get(rowKey(f));if(height)layout.setHeight(rowKey(f),height);}
 $('#spacer').style.height=`${layout.total}px`;
 if(restore)list.scrollTop=Math.min(positions.get(contextKey)||0,Math.max(0,layout.total-list.clientHeight));
 $('#count').textContent=`${results.length.toLocaleString()} 个字体家族${chosen.size>1?' · 已选 '+chosen.size+' 款':''}`;
 $('#group-bar').hidden=scope!=='group';
 $('#empty').hidden=!!results.length;
 $('#empty h2').textContent=o.query?'没有匹配的字体':scope==='favorites'?'还没有收藏':scope==='group'?'这个分组还没有字体':scope==='recent'?'尚未使用字体':'没有符合筛选的字体';
 $('#empty p').textContent=o.query?'试试较短的名称，或清除筛选。':scope==='favorites'?'点击字体行上的星标，随时保留喜欢的字款。':scope==='group'?'切换到“全部”，选中字体后点击卡片上的文件夹图标。':scope==='recent'?'选择或应用字体后，它们会出现在这里。':'清除分类条件，继续浏览全部字体。';
 render();
}
function queueRender(){if(!renderFrame)renderFrame=requestAnimationFrame(()=>{renderFrame=0;render();});}
function syncStyleOptions(row,f){
 const select=row._refs.styleSelect;if(!select)return;const signature=f.familyFaces.map(face=>face.id+'|'+face.style).join('\n');
 if(row.dataset.styles!==signature){const counts=new Map();for(const face of f.familyFaces){const label=face.style||face.id;counts.set(label,(counts.get(label)||0)+1);}select.replaceChildren(...f.familyFaces.map(face=>{const label=face.style||face.id,option=el('option','',label+(counts.get(label)>1?' · '+face.id:''));option.value=face.id;return option;}));row.dataset.styles=signature;}
 select.value=f.id;select.setAttribute('aria-label',`${f.family} 字款`);
}
function createRow(f){
 const row=el('div','font-row');row._group=f;row.dataset.family=f.familyKey;row.id='font-family-'+(++rowSequence);row.setAttribute('role','option');
 const heading=el('div','font-heading'),family=el('span','family',f.family);heading.append(family);let style,styleSelect;
 if(f.familyFaces.length>1){styleSelect=el('select','style family-style');styleSelect.title='选择字重或字型';styleSelect.onclick=e=>e.stopPropagation();styleSelect.ondblclick=e=>e.stopPropagation();styleSelect.onkeydown=e=>e.stopPropagation();styleSelect.onchange=e=>{e.stopPropagation();chooseStyle(row._group.familyKey,e.target.value);};heading.append(styleSelect);}else{style=el('span','style',f.style);heading.append(style);}
 const mark=el('span','row-meta');heading.append(mark);
 const actions=el('div','row-actions'),star=el('button','icon star'),add=el('button','icon');star.append(icon('star'));add.append(icon('folder'));add.setAttribute('aria-label',`将 ${f.family} 加入分组`);add.title='加入或移出分组';
 star.onclick=e=>{e.stopPropagation();mutate({type:'favorite',id:row._group.id}).catch(()=>{});};
 add.onclick=e=>{e.stopPropagation();const id=row._group.id;if(!chosen.has(id)){chosen=new Set([id]);current=id;updateRowsState();updateFooter();}openGroupMenu(add);};
 actions.append(star,add);const sample=el('div','sample'),loading=el('span','loading','正在绘制…'),img=el('img');img.alt='';sample.append(img,loading);const diagnostic=el('div','diagnostic');diagnostic.hidden=true;
 row.append(heading,actions,sample,diagnostic);
 row.onclick=e=>selectFont(row._group.id,e);row.ondblclick=()=>apply();row.oncontextmenu=e=>{e.preventDefault();const id=row._group.id;if(!chosen.has(id)){chosen=new Set([id]);current=id;}openGroupMenu(add);};
 row._refs={star,mark,sample,img,loading,diagnostic,style,styleSelect};return row;
}
const previewCache=new Map(),previewQueue=[],inflight=new Map();let busy=0;
function requestPreview(key,q){if(previewCache.has(key))return Promise.resolve(previewCache.get(key));if(inflight.has(key))return inflight.get(key);const promise=new Promise((resolve,reject)=>previewQueue.push({key,q,resolve,reject}));inflight.set(key,promise);pump();return promise;}
function pump(){while(busy<3&&previewQueue.length){const job=previewQueue.shift();busy++;metrics.previewRequests++;api('/api/preview?'+new URLSearchParams(job.q)).then(r=>{metrics.previewResponses++;previewCache.set(job.key,r);while(previewCache.size>64)previewCache.delete(previewCache.keys().next().value);job.resolve(r);}).catch(job.reject).finally(()=>{inflight.delete(job.key);busy--;pump();});}}
function preview(row,f){
 const width=Math.max(160,Math.round(row._refs.sample.clientWidth||list.clientWidth-40));
 const q={id:f.id,text:previewText(),size:settings.size,width};const key=JSON.stringify(q);if(row.dataset.previewKey===key)return;row.dataset.previewKey=key;const r=row._refs;r.img.removeAttribute('src');r.loading.hidden=false;r.diagnostic.hidden=true;
 requestPreview(key,q).then(p=>{if(row.dataset.previewKey!==key||!row.isConnected)return;r.loading.hidden=true;
  let sampleHeight=0;
  if(p.png&&p.layoutWidth&&p.layoutHeight){const scale=r.sample.clientWidth/p.layoutWidth;sampleHeight=p.layoutHeight*scale;r.img.style.width=Math.ceil(p.layoutWidth*scale)+'px';r.img.style.height=Math.ceil(sampleHeight)+'px';r.img.src='data:image/png;base64,'+p.png;}
  r.sample.style.height=Math.ceil(sampleHeight)+'px';
  const warnings=[];if(p.loadError)warnings.push({label:'无法加载',detail:String(p.loadError)});if(f.variable)warnings.push({label:'可变字体',detail:'该字款包含可变轴实例；Font Manage 当前按已注册实例预览。',kind:'info'});if(p.missing?.length)warnings.push({label:'缺字 '+p.missing.length,detail:'缺少：'+p.missing.join(' ')});if(p.fallback?.length)warnings.push({label:'已阻止回退',detail:'系统尝试回退到：'+p.fallback.join(', ')+'；这些字形未显示。'});if(p.variationIssue)warnings.push({label:'可变实例异常',detail:p.variationIssue});if(f.duplicateCount>1)warnings.push({label:'重复字体 '+f.duplicateCount,detail:'该字款有 '+f.duplicateCount+' 个重复文件'});
  const coverage=f.coverage?.[settings.language==='digits'?'numbers':settings.language];if(coverage&&coverage.ratio<1)warnings.push({label:coverage.supported?`覆盖 ${Math.round(coverage.ratio*100)}%`:coverage.ratio>0?'部分覆盖':'无该文字系统覆盖',detail:coverage.reason||'文字系统固定测试集覆盖情况'});
  r.diagnostic.replaceChildren(...warnings.map(w=>{const b=el('button','diag-pill'+(w.kind?' '+w.kind:''),w.label);b.type='button';b.title=w.detail;b.onclick=e=>{e.stopPropagation();message(w.label+'：'+w.detail);};return b;}));r.diagnostic.hidden=!warnings.length;r.diagnostic.title=warnings.map(w=>w.detail).filter(Boolean).join('\n');row.dataset.previewStatus=p.loadError?'error':p.missing?.length?'missing':'ready';
  const nextHeight=Math.max(ROW,6+22+2+sampleHeight+(warnings.length?20:4)+6+GAP),index=results.findIndex(item=>rowKey(item)===rowKey(f)),oldScroll=list.scrollTop,wasAbove=index>=0&&layout.offset(index)<oldScroll;
  measured.set(rowKey(f),nextHeight);const delta=layout.setHeight(rowKey(f),nextHeight);if(delta&&wasAbove)list.scrollTop=Math.max(0,oldScroll+delta);queueRender();
 }).catch(e=>{if(row.dataset.previewKey===key){r.loading.textContent='预览失败';const b=el('button','diag-pill','预览失败');b.type='button';b.title=e.message;b.onclick=ev=>{ev.stopPropagation();message(e.message,true);};r.diagnostic.replaceChildren(b);r.diagnostic.hidden=false;}});
}
function updateRow(row,f){
 row._group=f;row.dataset.font=f.id;row.dataset.family=f.familyKey;row.setAttribute('aria-label',`${f.family} ${f.style}`);row.title=`${f.family} · ${f.style}\n${f.id}`;
 const selected=chosen.has(f.id);row.classList.toggle('selected',selected);row.classList.toggle('keyboard',document.activeElement===list&&current===f.id);row.setAttribute('aria-selected',String(selected));const r=row._refs;if(r.style)r.style.textContent=f.style;syncStyleOptions(row,f);
 const fav=state.favorites.includes(f.id);r.star.classList.toggle('active',fav);r.star.setAttribute('aria-pressed',String(fav));r.star.setAttribute('aria-label',`${fav?'取消收藏':'收藏'} ${f.family} ${f.style}`);r.star.title=fav?'取消收藏':'收藏';const groups=state.groups.filter(g=>g.fonts.includes(f.id));r.mark.textContent=groups.length?`${groups.length} 组`:'';r.mark.title=groups.map(g=>g.name).join('、');r.mark.classList.toggle('group-mark',!!groups.length);
}
function render(){if(!state)return;metrics.renders++;const range=layout.range(list.scrollTop,list.clientHeight,3);const visible=new Set(results.slice(range.start,range.end).map(rowKey));for(const [id,row] of rowMap)if(!visible.has(id)){row.remove();rowMap.delete(id);}
 for(let i=range.start;i<range.end;i++){const f=results[i],key=rowKey(f);let row=rowMap.get(key);if(!row){row=createRow(f);rowMap.set(key,row);rows.append(row);}row.style.transform=`translateY(${layout.offset(i)}px)`;row.style.height=(layout.height(i)-GAP)+'px';row.setAttribute('aria-posinset',String(i+1));row.setAttribute('aria-setsize',String(results.length));updateRow(row,f);preview(row,f);}
 $('#spacer').style.height=`${layout.total}px`;metrics.maxRows=Math.max(metrics.maxRows,rowMap.size);const currentGroup=results.find(f=>f.id===current),active=currentGroup&&rowMap.get(rowKey(currentGroup));if(active)list.setAttribute('aria-activedescendant',active.id);else list.removeAttribute('aria-activedescendant');
}
function updateRowsState(){for(const [key,row]of rowMap){const f=results.find(item=>rowKey(item)===key);if(f)updateRow(row,f);}}
function selectFont(id,e={}){
 const previous=current;current=id;const selectedFace=fonts.find(face=>face.id===id);if(selectedFace)familyChoices.set(fontFamilyKey(selectedFace),id);
 if(e.shiftKey&&anchor){const a=results.findIndex(f=>f.id===anchor),b=results.findIndex(f=>f.id===id);if(a>=0&&b>=0)chosen=new Set(results.slice(Math.min(a,b),Math.max(a,b)+1).map(f=>f.id));else chosen=new Set([id]);}
 else if(e.metaKey||e.ctrlKey){chosen.has(id)?chosen.delete(id):chosen.add(id);anchor=id;if(!chosen.has(id))current=[...chosen].at(-1)||'';}
 else{chosen=new Set([id]);anchor=id;}
 if(!chosen.size)current='';
 updateRowsState();updateFooter();$('#count').textContent=`${results.length.toLocaleString()} 个字体家族${chosen.size>1?' · 已选 '+chosen.size+' 款':''}`;
 if(current&&current!==previous)mutate({type:'select',id:current},false).then(()=>{if(scope==='recent'||$('#sort').value==='recent')refilter(false);}).catch(()=>{});
}
function chooseStyle(key,id){familyChoices.set(key,id);selectFont(id);refilter(false);}
function updateFooter(){const f=fonts.find(f=>f.id===current);
 let target='';if(!host.connected)target=host.statusText||'Affinity 未连接';else if(!host.count)target='在 Affinity 中选择文本对象';else if(host.editable===false)target='当前文本对象已锁定或不可编辑';else target=`${host.count} 个文本对象，当前 ${host.font||'混合字体'}`;
 const unavailable=host.connected&&affinityIDs.size&&f&&!affinityIDs.has(f.id);if(unavailable)target='这款字体尚未在 Affinity 中可用';
 $('#apply').disabled=!f||chosen.size!==1||!host.connected||!host.count||host.editable===false||!!unavailable;$('#apply').title=$('#apply').disabled?target:f?`将 ${f.family} ${f.style} 应用到所选文本`:'选择字体后应用';
 $('#focus-affinity').textContent=host.connected?'选择文本':host.status==='host-not-running'?'启动 Affinity':'重试连接';
}
async function apply(){if($('#apply').disabled)return;$('#apply').disabled=true;try{await api('/api/apply',{font:current,signature:host.signature});await mutate({type:'select',id:current},false);message('已应用并确认目标字体，可在 Affinity 中撤销');host=await api('/api/host');affinityIDs=new Set(host.affinityIDs||[]);}catch(e){message(e.message,true);}updateFooter();}
function refreshGroups(){const select=$('#group-select');select.replaceChildren();for(const g of state.groups){const o=el('option','',`${g.name} · ${g.fonts.length}`);o.value=g.id;select.append(o);}if(!state.groups.some(g=>g.id===group))group=state.groups[0]?.id||'';select.value=group;$('#rename-group').disabled=!group;$('#delete-group').disabled=!group;}
function setScope(next){scope=next;document.querySelectorAll('[data-scope]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.scope===scope)));closePopover();refilter(true);}
function groupForm(rename=false){editingGroup=rename?group:'';$('#group-modal').hidden=false;$('#group-form-title').textContent=rename?'重命名分组':'创建分组';$('#group-name').value=rename?state.groups.find(g=>g.id===group)?.name||'':'';$('#group-form button[type=submit]').textContent=rename?'保存':'创建';$('#group-name').focus();closePopover();}
let popoverReturn=null;
function closePopover(){const was=!$('#group-menu').hidden;$('#group-menu').hidden=true;if(was&&popoverReturn?.isConnected)popoverReturn.focus();}
function openGroupMenu(trigger){popoverReturn=trigger;const menu=$('#group-menu');menu.replaceChildren(el('h2','',`整理 ${chosen.size} 款字体`));if(!state.groups.length)menu.append(el('p','','尚未创建分组'));
 for(const g of state.groups){const all=[...chosen].every(id=>g.fonts.includes(id)),button=el('button');button.append(icon(all?'check':'plus'),el('span','',g.name),el('span','group-count',String(g.fonts.length)));button.setAttribute('aria-label',`${all?'移出':'加入'} ${g.name}`);button.onclick=()=>{mutate({type:all?'remove':'add',group:g.id,ids:[...chosen]}).then(()=>message(all?'已从分组移出':'已加入 '+g.name)).catch(()=>{});closePopover();};menu.append(button);}
 const create=el('button','','创建分组');create.prepend(icon('plus'));create.onclick=()=>groupForm();menu.append(create);menu.hidden=false;menu.style.top=Math.min(trigger.getBoundingClientRect().bottom+4,innerHeight-menu.offsetHeight-76)+'px';menu.querySelector('button')?.focus();
}
$('#search').oninput=()=>refilter(true);$('#kind').onchange=()=>{saveSettings({kind:$('#kind').value});refilter(true);};$('#sort').onchange=()=>{saveSettings({sort:$('#sort').value});refilter(true);};
$('#preview-text').oninput=e=>{setCustomText(e.target.value);render();};
function setPreviewType(value){saveSettings({language:value});$('#preview-text').value=previewText();applyPreviewCollapse();refilter(true);}
$('#language').onchange=e=>setPreviewType(e.target.value);
$('#reset-preview').onclick=()=>{setCustomText('');$('#preview-text').value=previewText();applyPreviewCollapse();render();};
$('#collapse-preview').onclick=()=>{saveSettings({previewCollapsed:!settings.previewCollapsed});applyPreviewCollapse();};
$('#preview-collapsed').onclick=()=>{saveSettings({previewCollapsed:false});applyPreviewCollapse();$('#preview-text').focus();};
$('#size').oninput=e=>{saveSettings({size:Number(e.target.value)});$('#size-label').textContent=settings.size+' px';render();};
$('#auto-launch').onchange=e=>saveSettings({affinityAutoLaunch:e.target.checked});
document.querySelectorAll('[data-scope]').forEach(b=>b.onclick=()=>setScope(b.dataset.scope));$('#group-select').onchange=e=>{group=e.target.value;refilter(true);};$('#new-group').onclick=()=>groupForm();$('#rename-group').onclick=()=>groupForm(true);$('#cancel-group').onclick=()=>{$('#group-modal').hidden=true;$('#new-group').focus();};
$('#group-form').onsubmit=async e=>{e.preventDefault();try{await mutate({type:editingGroup?'rename':'create',group:editingGroup||undefined,name:$('#group-name').value},false);group=editingGroup||state.groups.at(-1).id;$('#group-modal').hidden=true;refreshGroups();setScope('group');list.focus();message(editingGroup?'分组已重命名':'分组已创建');}catch{}};
$('#group-modal').addEventListener('pointerdown',e=>{if(e.target===$('#group-modal')){$('#group-modal').hidden=true;$('#new-group').focus();}});
$('#delete-group').onclick=()=>{const g=state.groups.find(g=>g.id===group);if(!g)return;const menu=$('#group-menu');popoverReturn=$('#delete-group');menu.replaceChildren(el('h2','',`删除“${g.name}”？`),el('p','','字体、收藏和其他分组都会保留。'));const yes=el('button','','删除分组'),no=el('button','','保留');yes.onclick=()=>{mutate({type:'delete',group}).then(()=>message('分组已删除')).catch(()=>{});closePopover();};no.onclick=closePopover;menu.append(yes,no);menu.hidden=false;menu.style.top='120px';no.focus();};
$('#settings').onclick=()=>{$('#settings-panel').hidden=!$('#settings-panel').hidden;$('#settings').setAttribute('aria-expanded',String(!$('#settings-panel').hidden));};
$('#export').onclick=()=>api('/api/export',{}).then(r=>message('已导出到 '+r.file)).catch(e=>message(e.message,true));
$('#focus-affinity').onclick=()=>api(host.connected?'/api/focus-affinity':'/api/reconnect',{}).catch(e=>message(e.message,true));
$('#import').onchange=async e=>{try{const file=e.target.files[0];if(file){await mutate({type:'import',json:await file.text()});message('收藏与分组已合并');}}catch{}e.target.value='';};
$('#apply').onclick=apply;async function closeWorkspace(){clearTimeout(saveTimer);try{await mutate({type:'settings',settings:{...settings}},false);await actionQueue;if(window.webkit?.messageHandlers?.close)window.webkit.messageHandlers.close.postMessage('close');else window.close();}catch(e){message('尚未保存：'+e.message,true);}}$('#close').onclick=closeWorkspace;window.fontManageClose=closeWorkspace;
list.onscroll=queueRender;list.onfocus=updateRowsState;list.onblur=updateRowsState;
new ResizeObserver(()=>{if(resizeFrame)return;resizeFrame=requestAnimationFrame(()=>{resizeFrame=0;for(const row of rowMap.values())row.dataset.previewKey='';render();});}).observe(list);
list.onkeydown=e=>{let i=results.findIndex(f=>f.id===current);if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End'].includes(e.key)){e.preventDefault();if(e.key==='Home')i=0;else if(e.key==='End')i=results.length-1;else if(e.key==='ArrowDown'||e.key==='ArrowUp')i=Math.max(0,Math.min(results.length-1,i+(e.key==='ArrowDown'?1:-1)));else i=Math.max(0,Math.min(results.length-1,layout.firstAtOrAfter(list.scrollTop+(e.key==='PageDown'?list.clientHeight:-list.clientHeight))));const f=results[i];if(f){selectFont(f.id,e);if(layout.offset(i)<list.scrollTop)list.scrollTop=layout.offset(i);else if(layout.offset(i+1)>list.scrollTop+list.clientHeight)list.scrollTop=layout.offset(i+1)-list.clientHeight;render();}}else if(e.key==='Enter'){e.preventDefault();apply();}else if(e.key===' '&&current){e.preventDefault();mutate({type:'favorite',id:current}).catch(()=>{});}};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closePopover();$('#group-modal').hidden=true;$('#settings-panel').hidden=true;$('#settings').setAttribute('aria-expanded','false');}if((e.metaKey||e.ctrlKey)&&e.key==='f'){e.preventDefault();$('#search').focus();}const menu=!$('#group-menu').hidden?$('#group-menu'):null;if(menu&&e.key==='Tab'){const buttons=[...menu.querySelectorAll('button')];if(!buttons.length)return;const idx=buttons.indexOf(document.activeElement);e.preventDefault();buttons[(idx+(e.shiftKey?-1:1)+buttons.length)%buttons.length].focus();}});
document.addEventListener('pointerdown',e=>{if(!$('#group-menu').hidden&&!$('#group-menu').contains(e.target)&&e.target!==popoverReturn)closePopover();const sp=$('#settings-panel');if(!sp.hidden&&!sp.contains(e.target)&&e.target!==$('#settings')&&!$('#settings').contains(e.target)){$('#settings-panel').hidden=true;$('#settings').setAttribute('aria-expanded','false');}});
async function init(){try{const d=await api('/api/bootstrap');({state,settings,fonts,host}=d);affinityIDs=new Set(d.affinityIDs||[]);current=host.font||'';if(current)chosen.add(current);$('#kind').value=settings.kind;$('#sort').value=settings.sort;$('#language').value=settings.language;$('#auto-launch').checked=settings.affinityAutoLaunch!==false;$('#size').value=settings.size;$('#size-label').textContent=settings.size+' px';$('#preview-text').value=previewText();$('#preview-text').placeholder='输入预览文字；留空则使用当前类型的默认样例';applyPreviewCollapse();refreshGroups();refilter();updateFooter();setInterval(async()=>{try{const next=await api('/api/host');if(next.signature!==host.signature&&next.font){current=next.font;chosen=new Set([current]);const face=fonts.find(item=>item.id===current);if(face)familyChoices.set(fontFamilyKey(face),current);refilter(false);}host=next;affinityIDs=new Set(next.affinityIDs||[]);updateFooter();}catch{}},1000);window.__fontManage={metrics,get results(){return results.length},get state(){return state},get selection(){return [...chosen]},get rendered(){return rowMap.size},get previewCache(){return previewCache.size},get totalHeight(){return layout.total},rowHeight(id){return measured.get(id)||ROW}};}catch(e){message(e.message,true);$('#count').textContent='字体读取失败';}}
init();
