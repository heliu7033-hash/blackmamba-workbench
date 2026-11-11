'use strict';

let featuredId, detailId;

function setupHome() {
  $('#map-project').onchange = event => { featuredId = event.target.value; inspectedStage = null; saveRouteContext(); render(); };
  $('#detail-close').onclick = () => $('#project-detail').close();
}

function thumbnails(item) {
  return Array.isArray(item.localPreviews) ? item.localPreviews.filter(p =>
    p && typeof p.name === 'string' && typeof p.src === 'string' &&
    /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(p.src)) : [];
}

function openProjectWorkflow(id) {
  featuredId=id;
  const project=items.find(p=>p.id===id);
  inspectedStage=projectStage(project).id;
  navigate('剧组流程');
  saveRouteContext();
}

function projectTile(item) {
  const stage=projectStage(item),number=stages.indexOf(stage)+1;
  const tile=button('',()=>openProjectWorkflow(item.id),'project-portal');
  tile.setAttribute('aria-label',item.name+' · '+stage.name+' · '+item.status+'，打开项目工作流');
  tile.dataset.project=item.id;
  tile.append(cardArt(item.id,item.name,stage.name,thumbnails(item)[0]));
  const copy=el('div','portal-copy');
  copy.append(el('span','portal-stage',String(number).padStart(2,'0')+' / 04 · '+stage.name+' · '+item.status),
    el('h2','',item.name),el('span','portal-open','进入项目工作流 ↗'));
  tile.append(copy);return tile;
}

function showDetail(id, section) {
  detailId = id;
  if (featuredId !== id) { featuredId = id; inspectedStage = null; saveRouteContext(); }
  renderDetail();
  const dialog = $('#project-detail');
  dialog.showModal();
  dialog.scrollTop = 0;
  if (section) {
    const target = dialog.querySelector(section);
    if (target) { target.scrollIntoView({block:'center'}); target.focus({preventScroll:true}); }
  }
}

function renderDetail() {
  const item = items.find(p => p.id === detailId);
  if (!item) return;
  $('#detail-title').textContent = item.name;
  const detail = projectCard(item);
  detail.querySelector('h3').remove();
  const shortcuts = el('div','detail-shortcuts');
  for (const [label,destination] of [['本机任务','任务'],['查看制作流程','剧组流程']]) {
    shortcuts.append(button(label, () => { featuredId = item.id; inspectedStage = projectStage(item).id; $('#project-detail').close(); navigate(destination); }));
  }
  const gallery = el('section', 'gallery');
  const heading = el('div', 'home-label');
  heading.append(el('h3', '', '素材预览'));
  const picker = el('input');
  picker.type = 'file'; picker.accept = 'image/*,video/*'; picker.hidden = true; picker.multiple = true;
  heading.append(button('添加缩略图', () => picker.click()), picker);
  picker.onchange = () => addPreviews(item.id, Array.from(picker.files));
  gallery.append(heading);
  coverCredit(gallery,item.id,thumbnails(item)[0]);
  const list = thumbnails(item);
  if (!list.length) gallery.append(el('p', '', '选取本机图片或视频生成缩略图，首张用作项目封面。'));
  const grid = el('div', 'thumb-grid');
  for (const preview of list) {
    const fig = el('figure'), img = el('img');
    img.alt = preview.name; img.src = preview.src;
    fig.append(img, el('figcaption', '', (preview.video ? '视频 · ' : '') + preview.name)); grid.append(fig);
  }
  gallery.append(grid);
  $('#detail-body').replaceChildren(shortcuts, detail, gallery);
}

async function makePreview(file) {
  const video = file.type.startsWith('video/');
  if (!video && !file.type.startsWith('image/')) throw Error('不支持的媒体格式');
  const source = document.createElement(video ? 'video' : 'img');
  const url = URL.createObjectURL(file);
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('读取素材超时')), 12000);
      const done = () => { clearTimeout(timeout); resolve(); };
      source.onerror = () => { clearTimeout(timeout); reject(Error('浏览器无法解码此素材')); };
      if (video) {
        source.preload = 'auto'; source.muted = true; source.playsInline = true;
        source.onloadeddata = () => {
          if (!Number.isFinite(source.duration) || source.duration <= 0.1) return done();
          source.onseeked = done; source.currentTime = Math.min(0.5, source.duration / 2);
        };
      } else source.onload = done;
      source.src = url;
    });
    const w = video ? source.videoWidth : source.naturalWidth;
    const h = video ? source.videoHeight : source.naturalHeight;
    if (!w || !h) throw Error('无法生成预览');
    const scale = Math.min(1, 720 / Math.max(w,h));
    const canvas = el('canvas'); canvas.width = Math.max(1,Math.round(w*scale)); canvas.height = Math.max(1,Math.round(h*scale));
    canvas.getContext('2d').drawImage(source,0,0,canvas.width,canvas.height);
    return {name:file.name, video, src:canvas.toDataURL('image/jpeg',0.72)};
  } finally {
    source.removeAttribute('src'); if (video) source.load(); URL.revokeObjectURL(url);
  }
}

async function addPreviews(id, files) {
  if (!files.length) return;
  if (files.length > 12) return toast('每次最多选取 12 个素材。');
  try {
    const additions = [];
    for (const file of files) additions.push(await makePreview(file));
    const current = items.find(item => item.id === id);
    if (!current) return;
    const next = items.map(item => item.id === id ? {...item, localPreviews:[...thumbnails(item), ...additions]} : item);
    const backup = {format:'blackmamba-command-backup',version:1,exportedAt:new Date().toISOString(),items:next};
    if (new Blob([JSON.stringify(backup,null,2)]).size > 5000000) return toast('预览超出备份容量，请减少本次选择的素材。');
    if (persist(next)) toast('已保存素材缩略图');
  } catch (error) { toast(error.message || '无法生成缩略图'); }
}

// Older records keep both the action and pending decisions in one free-text field.
// Only recognize explicit labels. Keep the exact source available in the detail view.
function actionSummary(text) {
  const parts = Array.from(text.matchAll(/(?:^|[。；;\n])\s*(待确认|下一步)(?:仍是|是|为|[：:])?\s*([^。；;\n]+)/g));
  return {
    next: parts.find(m => m[1] === '下一步')?.[2] || (parts[0]?.[1] === '待确认' ? '' : text),
    pending: parts.find(m => m[1] === '待确认')?.[2] || ''
  };
}

function renderHome() {
  const projects=items.filter(p=>p.type==='项目').slice().sort((a,b)=>
    Number(a.status==='已归档')-Number(b.status==='已归档') ||
    Number(b.status==='进行中')-Number(a.status==='进行中') || (b.updatedAt||0)-(a.updatedAt||0));
  const target=$('#project-portals');target.replaceChildren(...projects.map(projectTile));
  if(!projects.length)target.append(el('p','home-empty','还没有项目。点击「新建项目」，开始第一份创作。'));
}

let inspectedStage;
function contextProject() {
  const projects = liveProjects();
  return items.find(p => p.type === '项目' && p.id === featuredId) || (projects.length === 1 ? projects[0] : null);
}

function linkedIDs(project, stage) {
  const sections=phaseFor(stage)?.sections || [];
  return [...new Set(sections.flatMap(key=>{
    const ids=project?.stageTaskIds?.[key];
    return Array.isArray(ids)?ids.filter(id=>typeof id==='string'):[];
  }))];
}

function isBlocked(text) {
  const reason = /(?:^|[。；;\n])\s*(?:当前阻塞|阻塞|受阻)[：:]\s*([^。；;\n]+)/u.exec(text || '')?.[1]?.trim();
  return Boolean(reason && !/^(?:无|暂无|无阻塞|已解除|已解决|无阻塞事项)[。.!！]?$/u.test(reason));
}

function stageReading(project, stage) {
  const done = stage.checks.filter(check => checkedAt(project,check)).length;
  const current = phaseFor(project?.stage) === stage;
  const linked = linkedIDs(project, stage.id).map(id => window.MambaTaskBoard?.lookup(id)).filter(Boolean);
  let status = '无记录';
  if (project) {
    if ((current && project.status === '进行中' && isBlocked(project.nextStep)) ||
        linked.some(t => ['进行中','等待确认','待开始'].includes(t.status) && (isBlocked(t.result) || isBlocked(t.notes)))) status = '阻塞';
    else if (done === stage.checks.length) status = '清单已完成';
    else if (project.status === '已完成') status = '待核实';
    else if ((current && project.status === '进行中') || done > 0) status = '进行中';
    else if (project.status === '待开始' || stages.indexOf(stage) > stages.indexOf(projectStage(project))) status = '待开始';
    else status = '待核实';
  }
  return {done,current,status};
}

function renderContext(target, project, destination) {
  target.replaceChildren();
  if (!project) {
    target.append(el('p','',liveProjects().length ? '请选择上方的制作项目，查看阶段和今日行动。' : '暂无可选制作项目，可新建项目后查看阶段和今日行动。'));
    return;
  }
  const meta = el('div','context-project');
  meta.append(el('span','action-label', projectStage(project).name + ' · ' + project.status), el('h2','',project.name));
  const summary = actionSummary(project.nextStep);
  const action = el('div','context-action');
  action.append(el('span','action-label','今日行动'),el('strong','',project.status === '已完成' ? '项目已完成' : summary.next || summary.pending || '尚未记录下一步'));
  target.append(meta, action, button(destination === '任务' ? '本机任务 →' : '制作流程 →',() => navigate(destination)));
}

function renderTaskContext() { renderContext($('#task-context'),contextProject(),'剧组流程'); }

function renderProjectPicker() {
  const projects = items.filter(p=>p.type==='项目');
  const picker = $('#map-project');
  const project = contextProject();
  const options = projects.map(p => new Option(p.name,p.id));
  if (!project) options.unshift(new Option(projects.length ? '请选择制作项目' : '暂无制作项目',''));
  picker.replaceChildren(...options);
  picker.value = project?.id || '';
  picker.disabled = !projects.length;
  $('#workflow-add').hidden = view === '任务' && projects.length > 0;
}

function openWorkflowStage(project,stageId,section) {
  featuredId=project.id;inspectedStage=stageId;navigate('阶段');saveRouteContext();
  if(section)requestAnimationFrame(()=>$('#stage-content').querySelector(section)?.scrollIntoView({block:'start',behavior:'instant'}));
}

function workflowStageEvidence(project,stage) {
  const reading=stageReading(project,stage);
  const records=stageRows(project).filter(row=>stage.sections.includes(row.stage));
  const linked=linkedIDs(project,stage.id).map(id=>({id,task:window.MambaTaskBoard?.lookup(id)}));
  const pending=stage.checks.filter(check=>!checkedAt(project,check));
  if(reading.status!=='阻塞' && (linked.some(x=>x.task?.status==='进行中') || records.some(x=>x.status==='工作中')))reading.status='进行中';
  if(!['阻塞','进行中'].includes(reading.status) && linked.some(x=>x.task?.status==='等待确认'))reading.status='等待确认';
  // A recorded version is evidence of work, never proof of stage approval.
  if(reading.status==='待开始' && (records.length || linked.some(x=>x.task?.status==='已完成')))reading.status='已有记录 · 待核实';
  return {...reading,records,linked,pending};
}

async function replaceProjectCover(project,file) {
  if(!file)return;
  try {
    const preview=await makePreview(file),current=items.find(p=>p.id===project.id);if(!current)return;
    const next=items.map(p=>p.id===project.id?{...p,localPreviews:[preview,...thumbnails(current)],updatedAt:Date.now()}:p);
    if(new Blob([JSON.stringify({format:'blackmamba-command-backup',version:1,exportedAt:new Date().toISOString(),items:next},null,2)]).size>5000000)throw Error('缩略图超出备份容量，请减少项目预览图片。');
    if(persist(next))toast('项目封面已更新');
  }catch(e){toast(e.message||'无法更新封面');}
}

function renderWorkflow() {
  const project=contextProject(),root=$('#map-today'),board=$('#workflow-board'),inspector=$('#stage-inspector');
  root.replaceChildren();board.replaceChildren();inspector.replaceChildren();
  board.hidden=!project;inspector.hidden=true;
  renderRoles();
  if(!project){root.append(el('p','',items.some(p=>p.type==='项目')?'请选择一个项目，查看它的制作工作流。':'还没有项目。新建项目后，在这里展开制作工作流。'));return;}
  $('#title').textContent='项目工作流';$('#subtitle').textContent=project.name;
  const main=el('div','tree-root-card'),cover=el('div','tree-root-cover');cover.append(cardArt(project.id,project.name,projectStage(project).name,thumbnails(project)[0]));
  const info=el('div','tree-root-info');info.append(el('small','action-label','PROJECT / '+project.status),el('h2','',project.name),el('p','','当前阶段 · '+projectStage(project).name));
  const commands=el('div','tree-root-actions');
  const historical=['已完成','已归档'].includes(project.status);
  commands.append(button((historical?'查看':'继续')+projectStage(project).name+' →',()=>openWorkflowStage(project,projectStage(project).id),'primary'),button('项目详情',()=>showDetail(project.id)));
  const picker=el('input');picker.type='file';picker.accept='image/*,video/*';picker.hidden=true;picker.setAttribute('aria-label','选择项目封面');picker.onchange=()=>replaceProjectCover(project,picker.files[0]);
  commands.append(button('更换封面',()=>picker.click()),picker);main.append(cover,info,commands);root.append(main);
  const summary=actionSummary(project.nextStep);
  if(summary.next||summary.pending){const note=el('div','tree-next');if(summary.next)note.append(el('p','',(historical?'原下一步记录 · ':'下一步 · ')+summary.next));if(summary.pending)note.append(el('p','',(historical?'原待确认记录 · ':'待确认 · ')+summary.pending));root.append(note);}
  for(const [index,stage] of stages.entries()){
    const evidence=workflowStageEvidence(project,stage),branch=el('section','tree-branch');branch.dataset.stage=stage.id;branch.dataset.current=String(evidence.current);
    const node=button('',()=>openWorkflowStage(project,stage.id),'tree-stage');
    node.setAttribute('aria-label',stage.name+'，'+(evidence.current?'当前阶段，':'')+evidence.status+'，打开阶段');
    if(evidence.current)node.setAttribute('aria-current','step');
    node.append(el('span','tree-stage-number',String(index+1).padStart(2,'0')),el('h3','',stage.name),el('span','tree-state',(evidence.current?'当前 · ':'')+evidence.status));
    if(evidence.status==='阻塞')node.dataset.blocked='true';
    branch.append(node);
    const children=el('div','tree-children');
    if(stage.id==='edit'){
      const packet=materialPackages(project).at(-1),inbox=button('',()=>openWorkflowStage(project,'edit'),'tree-leaf tree-entry');
      inbox.append(el('strong','',packet?'已接收 '+packet.title:'等待素材交接'),el('small','',packet?packet.copyDraft.title+' · '+packet.assets.length+' 项文件':'从素材制作选择文件交给剪辑 →'));children.append(inbox);
      for(const kind of ['resolve','ae']){
        const latest=postVersions(project,kind).at(-1),leaf=button('',()=>latest?showStageOutput(project,latest):openWorkflowStage(project,'edit'),'tree-leaf tree-entry post-tree-entry');
        const input=kind==='ae'?activeAeInput(project):null;
        leaf.append(el('strong','',latest?outputTitle(latest):postLabel(kind)+'版本'),el('small','',latest?latest.status+' · 点击查看':input?'已接收底片 '+input.version+' · 待包装':'尚未接收导出 →'));children.append(leaf);
      }
      branch.append(children);board.append(branch);continue;
    }
    const outputs=stageOutputs(project,stage),latest=outputs.at(-1);
    const result=button('',()=>latest?showStageOutput(project,latest):openWorkflowStage(project,stage.id),'tree-leaf tree-entry');
    const empty={brief:'开始文案对话',preproduction:'登记制作素材',edit:'登记剪辑版本',delivery:'登记交付与验收'};
    result.append(el('strong','',latest?outputTitle(latest):empty[stage.id]),el('small','',latest?(latest.status||'待核实')+' · 点击查看':(stage.id==='brief'?'尚未保存文案':'尚未登记成果')+' →'));
    children.append(result);
    if(stage.id==='preproduction'&&typeof hydrateMaterialBranch==='function')queueMicrotask(()=>hydrateMaterialBranch(project,result));
    if(outputs.length>1){const history=el('details','tree-leaf tree-history');history.append(el('summary','',stage.id==='brief'?'历史文案 · '+(outputs.length-1)+' 稿':'其他记录 · '+(outputs.length-1)+' 条'));
      for(const row of outputs.slice(0,-1).reverse().slice(0,4)){const go=button('',()=>showStageOutput(project,row),'tree-record');go.append(el('span','',outputTitle(row)),el('small','',row.status||'待核实'));history.append(go);}
      if(outputs.length>5)history.append(button('查看全部 →',()=>openWorkflowStage(project,stage.id,'.stage-outputs')));children.append(history);}
    branch.append(children);board.append(branch);
  }
}

function toggleStageTask(task, project, stageId) {
  const ids = linkedIDs(project,stageId);
  const phase=phaseFor(stageId);
  if(!phase)return;
  const stageTaskIds={...project.stageTaskIds}, remove=ids.includes(task.id);
  if(remove) {
    for (const key of phase.sections) if (Array.isArray(stageTaskIds[key])) stageTaskIds[key]=stageTaskIds[key].filter(id=>id!==task.id);
  } else {
    const key=phase.id;
    stageTaskIds[key]=[...(stageTaskIds[key]||[]),task.id];
  }
  if (persist(items.map(p => p.id===project.id ? {...p,stageTaskIds} : p))) toast(remove?'已解除阶段关联':'任务已关联到阶段');
}
