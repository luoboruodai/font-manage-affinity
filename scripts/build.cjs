'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
let bundle='// Font Manage 0.2.0 · Affinity workspace adapter\n// Run once from the Script Library while Font Manage is open.\nconst __fm = {};\n';
for(const name of ['host','bridge']){
 let source=fs.readFileSync(path.join(root,'src',name+'.js'),'utf8').replace("require('./host.js')",'__fm.host').replace("'__FONT_MANAGE_BRIDGE_PATH__'",JSON.stringify(path.join(root,'data')));
 bundle+=`__fm.${name}=(()=>{const module={exports:{}};\n${source}\nreturn module.exports;})();\n`;
}
fs.mkdirSync(path.join(root,'dist'),{recursive:true});fs.mkdirSync(path.join(root,'data'),{recursive:true});
fs.writeFileSync(path.join(root,'dist','Font Manage.js'),bundle);console.log('Built Affinity adapter: '+Buffer.byteLength(bundle)+' bytes');
