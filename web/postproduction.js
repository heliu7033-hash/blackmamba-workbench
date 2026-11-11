'use strict';
function postMedia(project,row){return {name:outputTitle(row),kind:'video',url:materialURL(project.id,'file',row.assetId),filename:row.media?.name||row.title+'.mp4'};}
function savePostProject(project){return persist(items.map(p=>p.id===project.id?project:p));}
function postCard(project,row){
  const card=el('article','post-card'),preview=button('',()=>openMediaViewer(postMedia(project,row)),'post-preview');
  preview.setAttribute('aria-label','大屏播放 '+outputTitle(row));const video=el('video');video.muted=true;video.preload='metadata';video.setAttribute('playsinline','');video.src=postMedia(project,row).url+'#t=0.1';preview.append(video,el('span','','▶ 大屏播放'));
  card.append(preview,el('h4','',outputTitle(row)),el('small','',row.status+' · '+new Date(row.date).toLocaleString('zh-CN')));
  if(row.upstream){const original=postVersions(project).find(r=>r.id===row.upstream.id);card.append(el('p','post-source','底片：'+row.upstream.title+' · '+row.upstream.version+(original?.status==='需修改'?' · 底片已标记需修改，请复核':'')));}
  if(row.materialPackage)card.append(el('p','handoff-summary',row.materialPackage.copyDraft.title+' → '+row.materialPackage.title));
  if(row.note)card.append(el('p','stage-text',row.note));
  const actions=el('div','post-actions');actions.append(button('版本详情 / 审核',()=>showStageOutput(project,row)));
  const download=el('a','viewer-download',row.postKind==='resolve'?'保存底片供 AE 使用':'保存包装成片');download.href=postMedia(project,row).url;download.download=row.media?.name||'export.mp4';actions.append(download);
  if(row.postKind==='resolve')actions.append(button('以此底片接收 AE 版本',()=>receivePostExport(project,'ae',row.id)));
  actions.append(button(row.postKind==='ae'?'转入交付归档':'无需包装，转入交付',()=>transferPostDelivery(project,row)));card.append(actions);return card;
}
function postproductionPanel(project){
  const panel=el('section','postproduction stage-outputs');panel.append(el('h2','','剪辑与包装版本'),el('p','study-note','达芬奇剪辑调色 → 接收导出底片 → AE 包装 → 交付归档。每次导出保存为新版本，旧版保留。'));
  panel.append(materialPackagePanel(project));
  const flow=el('div','post-flow');
  for(const [index,kind] of ['resolve','ae'].entries()){
    const col=el('section','post-column');col.dataset.kind=kind;col.append(el('span','action-label','0'+(index+1)),el('h3','',postLabel(kind)+'版本'));
    col.append(button(kind==='resolve'?'接收达芬奇导出':'接收 AE 包装导出',()=>receivePostExport(project,kind),'primary'));
    if(kind==='ae')col.append(aeInputPanel(project));
    const versions=postVersions(project,kind),latest=versions.at(-1);
    if(latest)col.append(postCard(project,latest));else col.append(el('p','post-empty',kind==='resolve'?'在达芬奇完成剪辑调色，导出视频后在这里选取文件。':'选择达芬奇底片进行包装，再接收 AE 导出成片。'));
    if(versions.length>1){const history=el('details','post-history');history.append(el('summary','','历史'+postLabel(kind)+'版本 · '+(versions.length-1)));for(const row of versions.slice(0,-1).reverse())history.append(postCard(project,row));col.append(history);}flow.append(col);
  }
  panel.append(flow);const old=stageRows(project).filter(r=>['edit','finish','sound'].includes(r.stage)&&!isPostVersion(r));
  if(old.length){const history=el('details','post-history');history.append(el('summary','','原有剪辑与声音记录 · '+old.length));old.slice().reverse().forEach(r=>history.append(stageRecordCard(project,r)));panel.append(history);}
  return panel;
}
function receivePostExport(project,kind,sourceId){
  const dialog=el('dialog','post-export-dialog'),form=el('form'),message=el('p','study-note');dialog.setAttribute('aria-label','接收'+postLabel(kind)+'导出');message.setAttribute('role','status');
  form.append(el('h2','','接收'+postLabel(kind)+'导出'),el('p','study-note','选取已经导出的视频，复制到当前项目的本机文件目录，原文件保留。单文件最多 20 GB；请预留同等磁盘空间。MP4 / H.264 适合预览，MOV 可保留底片；无法解码的格式仍可保存到本机使用。'));
  function field(label,input){const wrap=el('label','',label);wrap.append(input);form.append(wrap);return input;}
  const sources=postVersions(project,'resolve'),packets=materialPackages(project);let source,packet;
  if(kind==='resolve'){packet=el('select');packet.name='materialPackageId';packet.required=true;packet.append(new Option('选择本版使用的素材交接批次',''));for(const p of packets)packet.append(new Option(p.title+' · '+p.copyDraft.title+' · '+p.assets.length+' 项',p.id));packet.value=packets.at(-1)?.id||'';field('接收的素材',packet);if(!packets.length)form.append(el('p','receipt-warning','尚未接收素材，请先到素材制作选择文件并交给剪辑后期。'));}
  if(kind==='ae'){
    source=el('select');source.name='sourceId';source.required=true;source.append(new Option('选择本版使用的达芬奇底片',''));for(const r of sources)source.append(new Option(outputTitle(r)+' · '+r.status,r.id));source.value=sourceId||activeAeInput(project)?.id||sources.filter(r=>r.status==='已确认').at(-1)?.id||'';field('关联底片',source);
    if(!sources.length)form.append(el('p','study-note','请先接收一版达芬奇导出，再登记 AE 包装版本。'));
  }
  const file=field('视频导出文件',el('input'));file.type='file';file.name='video';file.accept='.mp4,.mov,.webm,.mkv';file.required=true;
  const projectPath=field('可编辑工程位置（可选）',el('input'));projectPath.name='projectPath';projectPath.maxLength=1000;projectPath.placeholder=kind==='ae'?'例如外置盘上的 .aep 路径':'例如 .drp 备份或工程位置';
  const note=field('本版修改说明',el('textarea'));note.name='note';note.maxLength=6000;note.rows=3;
  const submit=el('button','primary','接收并保存新版本');submit.type='submit';submit.disabled=kind==='ae'?!sources.length:!packets.length;
  const close=button('取消',()=>dialog.close()),actions=el('div','modal-actions');actions.append(close,submit);form.append(message,actions);dialog.append(form);document.body.append(dialog);dialog.onclose=()=>dialog.remove();dialog.showModal();
  const requestId=crypto.randomUUID();let asset,busy=false,selectedFile;
  file.onchange=()=>{if(asset&&file.files[0]!==selectedFile){message.textContent='文件已接收，请取消后另建新版本以更换文件。';file.value='';}else selectedFile=file.files[0];};
  dialog.oncancel=e=>{if(busy)e.preventDefault();};
  form.onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;submit.disabled=true;close.disabled=true;file.disabled=true;if(source)source.disabled=true;if(packet)packet.disabled=true;
    try{
      const current=items.find(p=>p.id===project.id);if(!current)throw Error('项目已不存在');if(kind==='resolve'&&!materialPackages(current).some(p=>p.id===packet.value))throw Error('请选择已接收的素材交接批次');if(kind==='ae'&&!postVersions(current,'resolve').some(r=>r.id===source.value))throw Error('请选择有效的达芬奇底片');
      if(!asset){const f=selectedFile||file.files[0];if(!f)throw Error('请选择视频导出文件');if(f.size>20*1024**3)throw Error('文件超过 20 GB，请先导出一份预览成片。');message.textContent='正在接收 '+f.name+'，请保持窗口开启…';
        const r=await fetch(materialURL(project.id,'upload',requestId),{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(f.name),'X-Category':encodeURIComponent('其他'),'X-Purpose':kind+'-export'},body:f});const result=await r.json();if(!r.ok)throw Error(result.error||'接收失败');asset=result;}
      const latest=items.find(p=>p.id===project.id);if(!latest)throw Error('项目已不存在');const result=appendPostVersion(latest,{id:requestId,kind,asset,sourceId:source?.value,materialPackageId:packet?.value,note:note.value.trim(),projectPath:projectPath.value.trim()});
      if(!savePostProject(result.project))throw Error('视频已接收，但版本记录未保存。请重试保存。');dialog.close();toast(postLabel(kind)+'新版本已保存，待播放复核');
    }catch(e){message.textContent=e.message;}finally{busy=false;submit.disabled=false;close.disabled=false;file.disabled=!!selectedFile;if(source)source.disabled=false;if(packet)packet.disabled=false;}
  };
}
function transferPostDelivery(project,row){
  try{const current=items.find(p=>p.id===project.id);if(!current)throw Error('项目已不存在');const result=appendPostDelivery(current,row.id);if(savePostProject(result.project)){openWorkflowStage(result.project,'delivery');toast('已建立待交付记录，尚未标记客户验收或归档完成');}}
  catch(e){toast(e.message);}
}
function postReviewActions(project,row,dialog){
  const actions=el('div','modal-actions'),label=el('label','','版本状态 '),select=el('select');select.setAttribute('aria-label','版本状态');const delivery=row.source==='post-delivery';
  for(const status of delivery?['待交付','待验收','已验收','需修改']:['待复核','已确认','需修改','历史版本'])select.append(new Option(status,status));select.value=row.status;
  const note=el('textarea');note.setAttribute('aria-label',delivery?'交付与验收记录':'版本反馈');note.rows=3;note.maxLength=6000;note.value=row.reviewNote||'';note.placeholder=delivery?'记录交付时间、客户反馈与归档位置':'可记录时间码反馈，例如 00:12 字幕需要调整';
  label.append(select);actions.append(label,note,button('保存状态与反馈',()=>{
    const current=items.find(p=>p.id===project.id),original=current?.stageEntries?.find(r=>r.id===row.id);if(!original)return toast('版本记录已不存在');
    if(original.status!==row.status||(original.reviewNote||'')!==(row.reviewNote||''))return toast('记录已被更新，请关闭后重新打开。');
    if(savePostProject({...current,stageEntries:current.stageEntries.map(r=>r.id===row.id?{...r,status:select.value,reviewNote:note.value.trim()}:r),updatedAt:Date.now()})){dialog.close();toast('版本状态已更新');}
  }),button('大屏播放',()=>openMediaViewer(postMedia(project,row))));return actions;
}
