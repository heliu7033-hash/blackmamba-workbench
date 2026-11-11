'use strict';

const stageSections = {
  brief: /当前提案|项目简报|项目目标|需求简报/,
  creative: /当前故事|台词|导演方案|人物与素材|分镜脚本|参考方向|当前提案/,
  preproduction: /拍摄与色彩|拍摄计划|准备事项|人物与素材/,
  production: /拍摄与色彩/,
  edit: /版本区分/, finish: /版本区分/, sound: /声音设计|混音/, delivery: /归档说明/
};
const stageEntryNames = {brief:'简报补充',creative:'导演方案与脚本',preproduction:'准备事项',production:'素材',edit:'粗剪版本',finish:'精剪版本',sound:'声音版本',delivery:'交付物'};

function splitBrief(notes) {
  const parts = [], headers = [...(notes || '').matchAll(/【([^【】\n]{1,90})】/g)];
  if (headers[0]?.index) parts.push({title:'项目简报',text:notes.slice(0,headers[0].index).trim()});
  headers.forEach((h,i) => parts.push({title:h[1],text:notes.slice(h.index+h[0].length,headers[i+1]?.index).trim()}));
  if (!headers.length && notes) parts.push({title:'项目简报',text:notes});
  return parts;
}

function archiveMedia(parts) {
  const listing = parts.find(p=>/素材索引/.test(p.title) && /assets\//.test(p.text));
  if (!listing) return [];
  const root = parts.map(p=>p.text.match(/^\/Volumes\/[^\n]+$/m)?.[0]).find(Boolean);
  return [...listing.text.matchAll(/^\d+[.．]\s*([^\n]+)\n(assets\/[^\n]+)\n([^\n]+)/gm)].map(m=>({
    name:m[1].trim(), path:(root ? root+'/' : '')+m[2].trim(), note:m[3].trim(), file:m[2].slice(7).trim()
  }));
}

function stageBlock(title, text) {
  const section = el('section','stage-block'); section.append(el('h3','',title));
  if (text) section.append(el('p','stage-text',text));
  return section;
}
function addCopyAction(target, label, value) {
  target.append(button(label,async () => {
    try { await navigator.clipboard.writeText(value); toast('已复制'); }
    catch { const field=el('textarea');field.readOnly=true;field.value=value;target.append(field);field.focus();field.select(); }
  }));
}
function stageRows(project) {
  return Array.isArray(project.stageEntries) ? project.stageEntries.filter(x=>x && typeof x.title==='string') : [];
}
function archiveCard(asset, project) {
  const box=el('article','archive-card');
  coverIndex.then(index=>{
    const source=index['archive/'+project.id+'/'+asset.file];
    if (source) {const img=el('img');img.alt=source.alt;img.src=source.src;box.prepend(img);}
  });
  box.append(el('strong','',asset.name),el('p','',asset.note));
  const loc=el('details');loc.append(el('summary','','文件位置'),el('p','stage-location',asset.path));addCopyAction(loc,'复制位置',asset.path);box.append(loc);return box;
}

function renderStageContent() {
  const pane=$('#stage-content'),project=contextProject(),stage=phaseFor(inspectedStage)||stages[0];
  pane.replaceChildren();pane.classList.add('stage-focused');
  $('#title').textContent=stage.name;$('#crumb').textContent='项目 / '+stage.short;$('#subtitle').textContent=project?.name||'';
  if(!project){pane.append(el('p','','请选择项目后继续。'),button('选择项目',()=>navigate('总览')));return;}
  const nav=el('nav','stage-paging');nav.setAttribute('aria-label','项目导航');
  nav.append(button('← 项目工作流',()=>openProjectWorkflow(project.id)));pane.append(nav);
  const rows=stageOutputs(project,stage),latest=rows.at(-1);
  if(stage.id==='brief')pane.append(creativeChatPanel(project));
  if(stage.id==='preproduction')pane.append(workflowCopyPanel(project),materialsStudio(project));
  if(stage.id==='edit')pane.append(postproductionPanel(project));
  const labels={brief:['已保存文案','对话完成后保存文案，这里和项目树会同步显示稿次。'],preproduction:['制作素材','登记本项目可供剪辑使用的素材及其位置。'],edit:['剪辑版本','登记剪辑、画面或声音版本，集中查看修改进展。'],delivery:['交付与验收','登记交付文件，并在客户反馈后更新验收状态。']};
  const log=stageBlock(labels[stage.id][0]);log.classList.add('stage-outputs');
  if(stage.id!=='brief')log.append(button(stage.id==='preproduction'?'登记素材':stage.id==='edit'?'登记剪辑版本':'登记交付',()=>editStageEntry(project.id,stage.id==='preproduction'?'production':stage.id),'primary'));
  if(latest)log.append(outputSummaryCard(project,latest));else log.append(el('p','study-note',labels[stage.id][1]));
  function folded(title){const box=el('details','role-details phase-fold');box.append(el('summary','',title));return box;}
  if(rows.length>1){const history=folded(stage.id==='brief'?'历史文案 · '+(rows.length-1)+' 稿':'其他记录 · '+(rows.length-1)+' 条');
    for(const row of rows.slice(0,-1).reverse())history.append(outputSummaryCard(project,row));log.append(history);}
  if(!['preproduction','edit'].includes(stage.id))pane.append(log);
  // Supporting context remains available without competing with the main work action.
  const support=folded('参考资料与项目管理');support.classList.add('stage-support');
  const parts=splitBrief(project.notes),remaining=stageRows(project).filter(row=>stage.sections.includes(row.stage)&&(stage.id==='preproduction'||!rows.some(r=>r.id===row.id)));
  if(stage.id==='preproduction'){const storyboard=folded('旧版分镜与动态预演');storyboard.classList.add('legacy-storyboards');storyboard.append(storyboardPanel(project));support.append(storyboard);}
  if(stage.id!=='delivery'){const palette=folded('视觉参考');palette.append(projectPalette(project));support.append(palette);}
  if(project.notes){const brief=folded('项目简报与原始资料');brief.append(el('p','stage-text',project.notes));support.append(brief);}
  if(remaining.length){const legacy=folded('补充记录 · '+remaining.length);remaining.slice().reverse().forEach(row=>legacy.append(stageRecordCard(project,row)));support.append(legacy);}
  const assets=archiveMedia(parts).filter(a=>stage.id==='preproduction'||stage.id==='brief'&&/分镜.*png$/i.test(a.file)||stage.id==='edit'&&/预演|插画动画/.test(a.name));
  if(assets.length){const archive=folded('历史素材 · '+assets.length),grid=el('div','archive-grid');assets.forEach(a=>grid.append(archiveCard(a,project)));archive.append(grid);support.append(archive);}
  if(stage.id==='delivery'){const prior=stageRows(project).filter(x=>phaseFor(x.stage)?.id==='edit');if(prior.length){const refs=folded('上游剪辑版本 · '+prior.length);prior.slice().reverse().forEach(row=>refs.append(stageRecordCard(project,row,false)));support.append(refs);}}
  if(project.nextStep)support.append(stageBlock('项目待办与待确认',project.nextStep));
  const done=stage.checks.filter(check=>checkedAt(project,check)).length,checks=folded('验收参考 · '+done+'/'+stage.checks.length);
  stage.checks.forEach(check=>checks.append(checklistControl(project,check,'map-check')));support.append(checks);
  const ids=linkedIDs(project,stage.id),tasks=folded('任务管理'+(ids.length?' · '+ids.length:''));
  for(const id of ids){const task=window.MambaTaskBoard?.lookup(id);tasks.append(el('p','',task?task.name+' · '+task.status:'当前读取范围外 · '+id));}
  tasks.append(button('查看 / 关联本机任务',()=>navigate('任务')));support.append(tasks);
  if(stage.id==='edit')addCopyAction(support,'复制制作交接单',[project.name,stage.handoff,...rows.map(x=>[x.title,x.version,x.software,x.path,x.status,x.note].filter(Boolean).join(' · '))].join('\n'));
  pane.append(support);
}

function outputSummaryCard(project,row) {
  const card=el('article','output-summary');
  const text=el('div');text.append(el('strong','',outputTitle(row)),el('small','',[row.status||'待核实',row.date?new Date(row.date).toLocaleDateString('zh-CN'):null].filter(Boolean).join(' · ')));
  card.append(text,button('查看',()=>showStageOutput(project,row)));return card;
}
function showStageOutput(project,row) {
  const dialog=el('dialog','output-dialog');dialog.setAttribute('aria-label',outputTitle(row));
  const content=stageRecordCard(project,row,false);dialog.append(content);
  const actions=el('div','modal-actions');
  if(row.note)addCopyAction(actions,'复制内容',row.note);
  if(isPostVersion(row)||row.source==='post-delivery')actions.append(postReviewActions(project,row,dialog));
  else if(isCopyDraft(row)){
    const label=el('label','','文案状态 '),status=el('select');status.setAttribute('aria-label','文案状态');
    for(const value of ['待复核','已确认','需修改','历史版本'])status.append(new Option(value,value));
    if(!Array.from(status.options).some(option=>option.value===row.status))status.append(new Option(row.status||'待复核',row.status||'待复核'));
    status.value=row.status||'待复核';label.append(status);actions.append(label,button('保存状态',()=>{
      const current=items.find(p=>p.id===project.id);if(!current)return toast('项目已不存在。');
      const rows=stageRows(current).map(r=>r.id===row.id?{...r,status:status.value}:r);
      if(persist(items.map(p=>p.id===project.id?{...p,stageEntries:rows,updatedAt:Date.now()}:p))){dialog.close();toast('文案状态已更新');}
    }),button('确认并交给素材制作',()=>{
      try{const current=items.find(p=>p.id===project.id);if(!current)throw Error('项目已不存在');
        const confirmed={...current,stageEntries:stageRows(current).map(r=>r.id===row.id?{...r,status:'已确认'}:r)};
        const received=receiveWorkflowCopy(confirmed,row.id);if(phaseFor(received.stage)?.id==='brief')received.stage='preproduction';
        if(persistWorkflowProject(received)){dialog.close();openWorkflowStage(received,'preproduction');toast(row.title+'已确认，素材制作已接收完整正文');}
      }catch(e){toast(e.message);}
    },'primary'),button('继续文案对话',()=>{dialog.close();openWorkflowStage(project,'brief');}));
  }
  else actions.append(button('编辑记录',()=>{dialog.close();editStageEntry(project.id,row.stage,row);}));
  actions.append(button('关闭',()=>dialog.close()));dialog.append(actions);document.body.append(dialog);
  dialog.onclose=()=>dialog.remove();dialog.showModal();
}

function stageRecordCard(project,row,editable=true) {
  const card=el('article','stage-record');
  card.append(el('h4','',row.title),el('small','',[isPostVersion(row)?postLabel(row.postKind):stageEntryNames[row.stage],row.version,row.date?new Date(row.date).toLocaleString('zh-CN'):null,row.software,row.kind,row.status].filter(Boolean).join(' · ')));
  if (row.note) card.append(el('p','stage-text',row.note));
  if(row.reviewNote)card.append(el('p','stage-text','反馈与验收记录：'+row.reviewNote));
  if(row.upstream)card.append(el('p','post-source','来源版本：'+row.upstream.title+' · '+row.upstream.version));
  if(isPostVersion(row)||row.source==='post-delivery')card.append(workflowTracePanel(project,row));
  if(row.projectPath){card.append(el('p','stage-location','可编辑工程：'+row.projectPath));addCopyAction(card,'复制工程位置',row.projectPath);}
  if(row.assetId&&(isPostVersion(row)||row.source==='post-delivery')){const download=el('a','viewer-download','保存视频文件');download.href=postMedia(project,row).url;download.download=row.media?.name||'export.mp4';card.append(el('p','stage-location','已接收文件：'+row.media?.name),download);}
  else if (row.path) {card.append(el('p','stage-location',row.path));addCopyAction(card,'复制文件位置',row.path);}
  if (row.preview && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(row.preview.src)) {const img=el('img');img.src=row.preview.src;img.alt=row.preview.name || row.title;card.append(img);}
  if (editable) card.append(button(isPostVersion(row)||row.source==='post-delivery'?'版本详情 / 审核':'编辑记录',()=>isPostVersion(row)||row.source==='post-delivery'?showStageOutput(project,row):editStageEntry(project.id,row.stage,row)));
  return card;
}

function editStageEntry(projectId,stageId,old) {
  const dialog=$('#stage-form-dialog'),form=el('form'), heading=el('h2','',phaseFor(stageId).name+' · '+(old?'编辑':'登记')+(phaseFor(stageId).id==='edit'?'版本':stageEntryNames[stageId]));heading.id='stage-form-title';dialog.replaceChildren(form);form.append(heading);
  const fields={};
  function field(key,label,options={}) {
    const wrap=el('label','',label),input=el(options.choices?'select':options.long?'textarea':'input');
    input.name=key;
    if (options.choices) for(const v of options.choices)input.append(new Option(v,v));
    else if(!options.long) input.type=options.type||'text';
    input.required=Boolean(options.required);input.maxLength=options.long?6000:600;
    if (options.hint) input.placeholder=options.hint;
    input.value=old?.[key] || options.initial || '';wrap.append(input);form.append(wrap);fields[key]=input;return input;
  }
  const versions=['edit','finish','sound','delivery'].includes(stageId), media=stageId==='production';
  if(phaseFor(stageId).id==='edit')field('versionKind','版本内容',{choices:['剪辑版本','画面精修','声音版本'],initial:stageId==='finish'?'画面精修':stageId==='sound'?'声音版本':'剪辑版本'});
  field('title','名称',{required:true});
  if (versions) field('version','版本号',{required:true,hint:'例如 v03'});
  const date=new Date();date.setMinutes(date.getMinutes()-date.getTimezoneOffset());
  field('date','记录时间',{type:'datetime-local',required:true,initial:date.toISOString().slice(0,16)});
  if(media)field('kind','素材类别',{choices:['实拍照片','实拍视频','AIGC 素材','底板与参考','其他'],initial:'实拍照片'});
  if(versions)field('software','使用软件',{hint:'例如 DaVinci Resolve、After Effects 或 Blender'});
  if(media||versions)field('path','文件或工程位置',{hint:'填写外置盘路径或交付链接',required:versions});
  field('status','状态',{choices:stageId==='delivery'?['待交付','待验收','已验收','需修改']:['待处理','工作中','测试','待复核','已确认','历史版本'],initial:stageId==='delivery'?'待交付':'待处理'});
  field('note',versions?'修改说明 / 验收记录':'内容与说明',{long:true,required:versions});
  let file;
  if(media){const wrap=el('label','','选取图片或视频生成缩略图（可选）');file=el('input');file.type='file';file.accept='image/*,video/*';wrap.append(file);form.append(wrap,el('small','study-note','只保存缩略图；素材本体保存在原位置。'));}
  const actions=el('div','modal-actions'),save=el('button','primary','保存记录');save.type='submit';const cancel=button('取消',()=>dialog.close());actions.append(cancel,save);form.append(actions);
  form.onsubmit=async e=>{
    e.preventDefault();if(save.disabled)return;save.disabled=true;cancel.disabled=true;
    try {
      const data=Object.fromEntries(Object.entries(fields).map(([k,f])=>[k,f.value.trim()]));
      if (!data.title || versions && (!data.version || !data.path || !data.note)) throw Error('请填写名称及所有必填内容。');
      if (media && !data.path && !file?.files[0] && !old?.preview) throw Error('请填写素材位置或选取本机素材。');
      const preview=file?.files[0]?await makePreview(file.files[0]):old?.preview;
      const record={...old,...data,id:old?.id||crypto.randomUUID(),stage:fields.versionKind?({'剪辑版本':'edit','画面精修':'finish','声音版本':'sound'}[data.versionKind]):stageId};if(preview)record.preview=preview;
      const project=items.find(x=>x.id===projectId);if(!project)throw Error('项目已不存在。');
      const list=stageRows(project); const updated=old?list.map(x=>x.id===old.id?record:x):[...list,record];
      const next=items.map(x=>x.id===projectId?{...x,stageEntries:updated,updatedAt:Date.now()}:x);
      if(new Blob([JSON.stringify({format:'blackmamba-command-backup',version:1,exportedAt:new Date().toISOString(),items:next},null,2)]).size>5000000)throw Error('已超过备份容量，请改为仅登记外置文件位置。');
      if (!dialog.open) return;
      if(persist(next)){dialog.close();toast('阶段记录已保存');}
    }catch(error){toast(error.message);}finally{save.disabled=false;cancel.disabled=false;}
  };
  dialog.showModal();fields.title.focus();
}
