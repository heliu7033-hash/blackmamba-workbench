'use strict';
(()=>{const q=s=>document.querySelector(s),state=q('#cloud-state'),form=q('#cloud-form'),dialog=q('#cloud-editor');let tasks=[],editing=null,requestId=null,busy=false,loaded=false;
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n};
async function api(action,args){const response=await fetch('/api/workbench',{method:action?'POST':'GET',credentials:'same-origin',headers:action?{'Content-Type':'application/json'}:{},body:action?JSON.stringify({action,args}):undefined});let data;try{data=await response.json()}catch{throw Error('服务返回异常，请重新打开站点。')}if(!response.ok)throw Error(data.error||'请求未完成');return data}
function render() {
  const target = q('#cloud-records');
  target.replaceChildren();
  if (!loaded) { target.append(node('p','任务尚未读取，可刷新查看。','cloud-empty')); return; }
  const list = tasks.filter(t => t.project === q('#cloud-project').value);
  const board = node('div',undefined,'task-board');
  for (const [label,states] of [['待开始',['待开始']],['进行中',['进行中']],['等待确认',['等待确认']],['已完成',['已完成']]]) {
    const matching = list.filter(t => states.includes(t.status));
    const lane = node('section',undefined,'task-lane');
    lane.dataset.state = label;
    const head = node('h3',label); head.append(node('small',String(matching.length))); lane.append(head);
    for (const task of matching) lane.append(taskCard(task));
    if (!matching.length) lane.append(node('p','暂无任务','lane-placeholder'));
    board.append(lane);
  }
  target.append(board);
  const archived = list.filter(t => t.status === '已归档');
  if (archived.length) {
    const group = node('details',undefined,'role-details');
    group.append(node('summary','已归档 · '+archived.length),...archived.map(taskCard)); target.append(group);
  }
}
function taskCard(t) {
  const card = node('details',undefined,'task-box');
  const summary = node('summary',t.name);
  if (['进行中','等待确认','待开始'].includes(t.status) && (isBlocked(t.result) || isBlocked(t.notes))) summary.append(node('span','阻塞','blocked-tag'));
  card.append(summary);
  if (t.notes) card.append(node('p',t.notes));
  if (t.result) card.append(node('p','实际成果 · '+t.result));
  card.append(node('small','版本 '+t.revision+' · '+new Date(t.updated_at).toLocaleDateString('zh-CN')));
  const actions = node('div',undefined,'task-buttons');
  const edit = node('button','更新状态 / 成果'); edit.onclick = () => open(t);
  const copy = node('button','复制给二黑');
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(['二黑，请先核对以下本机任务的最新记录并说明计划。未经确认请勿执行或修改项目文件。',t.name,'分区：'+t.project,'任务 ID：'+t.id,t.notes,'状态：'+t.status,t.result].filter(Boolean).join('\n')); toast('已复制任务'); }
    catch { toast('复制不可用。任务 ID：'+t.id); }
  };
  actions.append(edit,copy);
  const project = contextProject();
  if (project) {
    const stage = phaseFor(inspectedStage) || projectStage(project);
    const linked = linkedIDs(project,stage.id).includes(t.id);
    const link = node('button',(linked ? '解除关联：' : '关联到：')+project.name+' / '+stage.short);
    link.onclick = () => toggleStageTask(t,project,stage.id);
    actions.append(link);
  }
  card.append(actions);
  return card;
}
window.MambaTaskBoard = {render,lookup:id => tasks.find(t => t.id === id)};
async function refresh(){q('#cloud-refresh').disabled=true;state.textContent='正在读取本机磁盘…';try{const d=await api();tasks=d.tasks;loaded=true;render();if(view==='剧组流程')renderWorkflow();state.textContent='本机读取成功 · '+tasks.length+' 条记录（最多显示100条） · '+new Date().toLocaleTimeString('zh-CN')}catch(e){state.textContent=e.message+' 已显示的旧记录不会被清空。';if(!loaded)render()}finally{q('#cloud-refresh').disabled=false}}
function open(t=null,prefill=null){editing=t;requestId=crypto.randomUUID();form.reset();form.elements.project.value=t?.project||q('#cloud-project').value;form.elements.name.value=t?.name||prefill?.name||'';form.elements.notes.value=t?.notes||prefill?.notes||'';form.elements.project.disabled=!!t;form.elements.name.readOnly=!!t;form.elements.notes.readOnly=!!t;q('#cloud-status-label').hidden=q('#cloud-result-label').hidden=!t;if(t){form.elements.status.value=t.status;form.elements.result.value=t.result}q('#cloud-modal-title').textContent=t?'回写状态与实际成果':prefill?'确认本地记录迁移':'新建本机任务';q('#cloud-form-info').textContent=t?'任务 ID：'+t.id+' · 当前版本 '+t.revision:'提交后，这些内容将保存在本人私有工作台本机。';dialog.showModal()}
q('#cloud-new').onclick=()=>open();q('#cloud-refresh').onclick=refresh;q('#cloud-project').onchange=render;q('#cloud-close').onclick=q('#cloud-cancel').onclick=()=>{if(!busy)dialog.close()};dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault()});
form.onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;q('#cloud-submit').disabled=true;const args=editing?{id:editing.id,revision:editing.revision,status:form.elements.status.value,result:form.elements.result.value,request_id:requestId}:{project:form.elements.project.value,name:form.elements.name.value.trim(),notes:form.elements.notes.value.trim(),request_id:requestId};try{await api(editing?'update_workbench_task':'create_workbench_task',args);dialog.close();await refresh()}catch(e){q('#cloud-form-info').textContent=e.message+'。请勿重复新建；可关闭后刷新核对。'}finally{busy=false;q('#cloud-submit').disabled=false}};
let local=[];q('#cloud-migrate').onclick=()=>{try{local=JSON.parse(localStorage.getItem('blackmamba.command.v1')||'[]');if(!Array.isArray(local))throw Error();local=local.filter(x=>typeof x.name==='string'&&typeof x.notes==='string');if(!local.length){state.textContent='当前浏览器没有可迁移的本地记录。可先在原本地工作区导入备份。';return}q('#migration-record').replaceChildren(...local.map((x,i)=>{const n=node('option',x.name+' · '+x.type);n.value=String(i);return n}));q('#migration').showModal()}catch{state.textContent='本地记录读取失败，未写入任何内容。'}};q('#migration-cancel').onclick=()=>q('#migration').close();q('#migration-next').onclick=()=>{const t=local[Number(q('#migration-record').value)];if(!t)return;const notes=[t.notes,t.url?'链接：'+t.url:'',t.owner?'负责人：'+t.owner:'',t.due?'原目标日期：'+t.due:'','迁移自本地记录；原状态：'+t.status].filter(Boolean).join('\n\n');if(notes.length>10000){state.textContent='记录过长，请先在本地缩短备注后迁移。';q('#migration').close();return}q('#migration').close();open(null,{name:t.name,notes})};refresh();})();
