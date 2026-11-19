export const samples={latin:'The quick brown fox jumps over the lazy dog.','zh-Hans':'简体中文之美，始于细节。天地玄黄 0123','zh-Hant':'繁體中文之美，始於細節。天地玄黃 0123',ja:'美しい文字、伝わるデザイン。あいうえお 0123',ko:'한글의 아름다움, 가나다라마바사 0123',digits:'0123456789  € $ ¥  12:48  3.14159',symbols:'& @ # % + − = → ★ ◆ ♫'};
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
