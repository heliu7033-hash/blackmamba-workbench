import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
class Element {
  constructor(tag='div',className='',text=''){Object.assign(this,{tag,className,textContent:text,children:[],dataset:{},attributes:{}});}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  setAttribute(k,v){this.attributes[k]=v;}
}
const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
const project=(id,stage,status='进行中')=>({id,name:id,type:'项目',stage,status,notes:'',nextStep:'',checks:{},updatedAt:1});
const projects=[project('在制项目','production'),project('已完成项目','delivery','已完成'),project('归档项目','brief','已归档')];
const tasks=new Map([['live',{name:'正在调色',status:'进行中'}],['waiting',{name:'等待客户确认',status:'等待确认'}]]);
const context={window:{MambaTaskBoard:{lookup:id=>tasks.get(id)}},items:projects,
  el:(tag,cls,text)=>new Element(tag,cls,text),$ :node,button:(label,onclick,cls)=>Object.assign(new Element('button',cls,label),{onclick}),
  cardArt:()=>new Element('figure','card-art'),liveProjects:()=>projects.filter(p=>p.status!=='已归档'),
  stageRows:p=>p.stageEntries||[],navigate:v=>context.destination=v,saveRouteContext:()=>{},renderRoles:()=>{},
  requestAnimationFrame:()=>{},Option:class{},editStageEntry:()=>{}};
vm.createContext(context);
vm.runInContext(fs.readFileSync('web/workflow.js','utf8'),context);
vm.runInContext("const stages=window.MAMBA_WORKFLOW.stages;function projectStage(p){return phaseFor(p?.stage)||stages[0]}",context);
vm.runInContext(fs.readFileSync('web/production-records.js','utf8'),context);
vm.runInContext(fs.readFileSync('web/workflow-handoffs.js','utf8'),context);
vm.runInContext(fs.readFileSync('web/project-home.js','utf8'),context);
context.renderHome();assert.equal(node('#project-portals').children.length,3);
const portals=node('#project-portals').children;
assert.equal(portals[0].dataset.project,'在制项目');assert.match(portals[0].attributes['aria-label'],/素材制作/);
portals[0].onclick();assert.equal(context.destination,'剧组流程');assert.equal(context.contextProject().id,'在制项目');
context.renderWorkflow();const branches=node('#workflow-board').children;
assert.equal(branches.length,4);assert.equal(branches[0].children[1].children.length,1);assert.equal(branches[1].dataset.current,'true');
assert.equal(branches[0].children[0].attributes['aria-current'],undefined);
assert.match(branches[0].children[0].attributes['aria-label'],/待核实/);
branches[0].children[0].onclick();assert.equal(context.destination,'阶段');assert.equal(vm.runInContext('inspectedStage',context),'brief');
portals[2].onclick();assert.equal(context.contextProject().id,'归档项目');context.renderWorkflow();assert.equal(node('#workflow-board').children.length,4);
const p=projects[0],stages=context.window.MAMBA_WORKFLOW.stages;
p.stageEntries=[{stage:'creative',title:'待复核脚本',status:'待复核'}];
p.stageTaskIds={finish:['live'],sound:['missing'],delivery:['waiting']};
let e=context.workflowStageEvidence(p,stages[0]);assert.equal(e.records.length,1);assert.notEqual(e.status,'清单已完成');assert.equal(e.done,0);
e=context.workflowStageEvidence(p,stages[2]);assert.equal(e.status,'进行中');assert.equal(e.linked.length,2);assert.equal(e.linked[1].task,undefined);
assert.equal(context.workflowStageEvidence(p,stages[3]).status,'等待确认');
p.nextStep='当前阻塞：样品未到';assert.equal(context.workflowStageEvidence(p,stages[1]).status,'阻塞');
const snapshot=JSON.stringify(projects);context.renderHome();context.renderWorkflow();assert.equal(JSON.stringify(projects),snapshot);
const outer={open:false,parentElement:{closest:()=>null}},inner={open:false,parentElement:{closest:()=>outer}};
let focused=false;const replacement={closest:selector=>selector==='details'?inner:null,focus:()=>{focused=true;}};
context.document={querySelectorAll:()=>[replacement]};context.persist=next=>{context.items=next;return true;};
const control=context.checklistControl(p,stages[0].checks[0],'map-check').children[0];control.checked=true;control.onchange();
assert.equal(inner.open,true);assert.equal(outer.open,true);assert.equal(focused,true);
context.items=projects;projects.length=0;context.renderHome();assert.match(node('#project-portals').children[0].textContent,/还没有项目/);context.renderWorkflow();assert.equal(node('#workflow-board').hidden,true);
console.log('PASS project navigation, all-project cards, archived projects, ordered branches, live task states, missing task honesty, approval separation, empty state, read-only rendering');
