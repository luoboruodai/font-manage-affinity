export const samples={latin:'The quick brown fox jumps over the lazy dog.','zh-Hans':'简体中文之美，始于细节。天地玄黄 0123','zh-Hant':'繁體中文之美，始於細節。天地玄黃 0123',ja:'美しい文字、伝わるデザイン。あいうえお 0123',ko:'한글의 아름다움, 가나다라마바사 0123',digits:'0123456789  € $ ¥  12:48  3.14159',symbols:'& @ # % + − = → ★ ◆ ♫'};
const styleName=font=>String(font.style||'').toLowerCase().replace(/[_-]+/g,' ').replace(/([a-z])([0-9])/g,'$1 $2');
function faceWeight(font){
 const s=styleName(font),w=s.match(/\bw\s*([1-9])\b/);if(w)return Number(w[1])*100;
 if(/extra\s*light|ultra\s*light/.test(s))return 200;if(/semi\s*light/.test(s))return 350;if(/\blight\b|\bl\b/.test(s))return 300;
 if(/black|heavy/.test(s))return 900;if(/extra\s*bold|ultra\s*bold/.test(s))return 800;if(/semi\s*bold|demi\s*bold/.test(s))return 600;if(/\bbold\b|\bb\b/.test(s))return 700;
 if(/medium|\bmed\b/.test(s))return 500;return 400;
}
function screenScore(font){
 const s=styleName(font);let score=Math.abs(faceWeight(font)-400);
 if(/\bregular\b|\bnormal\b|\broman\b|\bplain\b|\br\b/.test(s))score-=30;if(/\bbook\b/.test(s))score-=10;if(/medium/.test(s))score-=15;
 if(/italic|oblique/.test(s))score+=160;if(/condensed|narrow|compressed/.test(s))score+=120;if(/outline|shadow|inline|stencil/.test(s))score+=250;
 return score;
}
function compareFaces(a,b){return faceWeight(a)-faceWeight(b)||Number(/italic|oblique/.test(styleName(a)))-Number(/italic|oblique/.test(styleName(b)))||(styleName(a)<styleName(b)?-1:styleName(a)>styleName(b)?1:a.id<b.id?-1:a.id>b.id?1:0);}
export function preferredScreenFace(faces){return faces.reduce((best,face)=>!best||screenScore(face)<screenScore(best)||(screenScore(face)===screenScore(best)&&compareFaces(face,best)<0)?face:best,undefined);}
export function fontFamilyKey(font){return String(font.family||font.id).trim().normalize('NFKC').toLowerCase();}
export function groupFontFamilies(matching,catalog,{preferredID='',selections=new Map()}={}){
 const all=new Map(),eligible=new Map();for(const face of catalog){const key=fontFamilyKey(face);if(!all.has(key))all.set(key,[]);all.get(key).push(face);}
 for(const face of matching){const key=fontFamilyKey(face);if(!eligible.has(key))eligible.set(key,[]);eligible.get(key).push(face);}
 return [...eligible].map(([key,matches])=>{const faces=(all.get(key)||matches).toSorted(compareFaces),choice=selections.get(key),selected=faces.find(face=>face.id===choice)||faces.find(face=>face.id===preferredID)||preferredScreenFace(matches);return {...selected,family:faces[0]?.family||selected.family,familyKey:key,rowKey:'family:'+key,familyFaces:faces,matchingFaces:matches};});
}
export function filterFonts(fonts,state,{query='',scope='all',group='',kind='all',language='all',sort='name'}={}){
 const fav=new Set(state.favorites),recent=new Map(state.recent.map((id,i)=>[id,i])),set=new Set(state.groups.find(g=>g.id===group)?.fonts||[]),terms=query.trim().toLowerCase().split(/\s+/).filter(Boolean);
 return fonts.filter(f=>(scope!=='favorites'||fav.has(f.id))&&(scope!=='recent'||recent.has(f.id))&&(scope!=='group'||set.has(f.id))&&(kind!=='serif'||f.isSerif)&&(kind!=='sans'||f.isSansSerif)&&(kind!=='mono'||f.isMonospaced)&&(language==='all'||f.languages?.includes(language))&&terms.every(t=>`${f.family} ${f.style} ${f.id}`.toLowerCase().includes(t))).sort((a,b)=>{
  if(sort==='recent'||scope==='recent'){const diff=(recent.get(a.id)??1e6)-(recent.get(b.id)??1e6);if(diff)return diff;}
  const x=`${a.family} ${a.style} ${a.id}`.toLowerCase(),y=`${b.family} ${b.style} ${b.id}`.toLowerCase();return (x<y?-1:x>y?1:0)*(sort==='desc'?-1:1);
 });
}
export function windowRange(total,scroll,height,row=116,overscan=3){const start=Math.max(0,Math.floor(scroll/row)-overscan);return {start,end:Math.min(total,Math.ceil((scroll+height)/row)+overscan)};}

export class VirtualRows {
 constructor(ids,minHeight=66){
  this.ids=ids;this.minHeight=minHeight;this.heights=new Map();this.indices=new Map(ids.map((id,index)=>[id,index]));this.tree=new Float64Array(ids.length+1);
  for(let i=1;i<=ids.length;i++)this.tree[i]=minHeight*(i&-i);
 }
 offset(index){let sum=0;for(let i=Math.max(0,Math.min(index,this.ids.length));i>0;i-=i&-i)sum+=this.tree[i];return sum;}
 get total(){return this.offset(this.ids.length);}
 height(index){return this.heights.get(this.ids[index])||this.minHeight;}
 setHeight(id,value){
  const index=this.indices.get(id)??-1;if(index<0)return 0;
  const height=Math.max(this.minHeight,Math.min(10000,Math.ceil(value))),delta=height-this.height(index);
  if(!delta)return 0;
  this.heights.set(id,height);
  for(let i=index+1;i<this.tree.length;i+=i&-i)this.tree[i]+=delta;
  return delta;
 }
 firstAtOrAfter(value){
  let low=0,high=this.ids.length;
  while(low<high){const middle=(low+high)>>1;if(this.offset(middle+1)>value)high=middle;else low=middle+1;}
  return low;
 }
 range(scroll,height,overscan=3){
  if(!this.ids.length)return {start:0,end:0};
  const start=Math.max(0,this.firstAtOrAfter(Math.max(0,scroll))-overscan);
  const end=Math.min(this.ids.length,this.firstAtOrAfter(Math.max(0,scroll)+Math.max(1,height))+1+overscan);
  return {start,end};
 }
}
