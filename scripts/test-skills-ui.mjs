import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
class Element {
  constructor(tag='div'){this.tag=tag;this.children=[];this.value='';this.checked=false;this.textContent='';}
  setAttribute(key,value){this[key]=value;}
  querySelector(){return null;}
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=[...items];}
}
const nodes=new Map();
const document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},createElement:tag=>new Element(tag)};
const entry=(name,group,state)=>({name,group,state,description:'A useful skill',source:group,path:'/skills/'+name,realPath:'/skills/'+name,version:''});
const fixture={scannedAt:new Date().toISOString(),entries:[entry('local','codex','installed'),entry('plugin','plugin','configured'),entry('cached','plugin','cached')],summary:{installedEntries:2,installedNames:2,cachedEntries:1},scope:'fixed roots',execution:'read-only',sources:[],warnings:[]};
let requests=0, fail=false;
const context={document,window:{},AbortSignal,fetch:async()=>{requests++;return {ok:!fail,json:async()=>fixture};}};
for (const script of ['skill-purposes','skills']) vm.runInNewContext(fs.readFileSync(new URL('../web/'+script+'.js',import.meta.url),'utf8'),context);
const get=id=>document.getElementById(id);
await context.window.MAMBA_SKILLS.load();assert.equal(get('skills-list').children.length,0);
assert.equal(get('skill-categories').children.at(-1).children[0].textContent,'其他');
get('skill-categories').children[0].onclick();assert.equal(get('skills-list').children.length,2);
await context.window.MAMBA_SKILLS.load();assert.equal(requests,1);
get('skills-source').value='plugin';get('skills-source').onchange();assert.equal(get('skills-list').children.length,1);
get('skills-cache').checked=true;get('skills-cache').onchange();assert.equal(get('skills-list').children.length,2);
get('skills-search').value='cached';get('skills-search').oninput();assert.equal(get('skills-list').children.length,1);assert.equal(get('skills-list').children[0].children[0].children[0].textContent,'cached');
get('skills-search').value='not-present';get('skills-search').oninput();assert.equal(get('skills-list').children[0].className,'empty');
get('skills-search').value='';fail=true;await get('skills-refresh').onclick();assert(get('skills-status').textContent.startsWith('重新扫描失败'));assert.equal(get('skills-list').children.length,2);assert.equal(get('skills-refresh').disabled,false);
fail=false;await get('skills-refresh').onclick();assert(!get('skills-status').textContent.startsWith('重新扫描失败'));assert.equal(requests,3);
console.log('PASS: Skills UI search, source/cache filters, empty state, cached loading, failed-refresh stale state, recovery');
