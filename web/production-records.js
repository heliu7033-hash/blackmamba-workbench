/* Saved outputs are distinct from planning notes and acceptance checklists. */
'use strict';
function isCopyDraft(row) {
  return row?.stage === 'creative' && (row.source === 'creative-chat' ||
    (typeof row.id === 'string' && row.id.startsWith('creative-') &&
      (row.version === '对话生成' || row.title?.startsWith('智能体文案'))));
}
function savedCopyDrafts(project) {
  let number=0;
  return (project.stageEntries || []).filter(isCopyDraft).map(row=>{
    number=Number.isSafeInteger(row.draftNumber) && row.draftNumber>number ? row.draftNumber : number+1;
    return {...row,source:'creative-chat',draftNumber:number,title:'文案第 '+number+' 稿',version:'第 '+number+' 稿'};
  });
}
function appendCopyDraft(project,draft,now=Date.now()) {
  if(!draft?.id || typeof draft.draft!=='string' || !draft.draft.trim())throw Error('没有可保存的完整文案。');
  const id='creative-'+draft.id,rows=project.stageEntries || [],existing=savedCopyDrafts(project).find(row=>row.id===id);
  if(existing)return {project,row:existing,created:false};
  const draftNumber=(savedCopyDrafts(project).at(-1)?.draftNumber || 0)+1;
  const row={id,stage:'creative',source:'creative-chat',draftNumber,title:'文案第 '+draftNumber+' 稿',
    version:'第 '+draftNumber+' 稿',status:'待复核',note:draft.draft,date:new Date(now).toISOString()};
  return {project:{...project,stageEntries:[...rows,row],updatedAt:now},row,created:true};
}
function stageOutputs(project,stage) {
  if(stage.id==='brief')return savedCopyDrafts(project);
  return (project.stageEntries || []).filter(row=>row && typeof row.title==='string' &&
    (stage.id==='preproduction' ? row.stage==='production' : stage.sections.includes(row.stage)));
}
function outputTitle(row) {return isCopyDraft(row) ? row.title : [row.title,row.version].filter(Boolean).join(' · ');}

// Exported media and its upstream version are immutable. Review status may change.
function isPostVersion(row){return row?.source==='postproduction'&&['resolve','ae'].includes(row.postKind);}
function postLabel(kind){return kind==='ae'?'AE 包装':'达芬奇剪辑调色';}
function postVersions(project,kind){return (project.stageEntries||[]).filter(r=>isPostVersion(r)&&(!kind||r.postKind===kind));}
function postSnapshot(row){return {id:row.id,title:row.title,version:row.version,postKind:row.postKind,assetId:row.assetId,sha256:row.media?.sha256,materialPackage:row.materialPackage};}
function appendPostVersion(project,{id,kind,asset,note='',sourceId,projectPath='',materialPackageId},now=Date.now()){
  if(!id||!['resolve','ae'].includes(kind)||asset?.kind!=='video'||asset.purpose!==kind+'-export'||!asset.id||!asset.sha256)throw Error('请先接收对应软件的视频导出文件。');
  const rows=project.stageEntries||[],existing=rows.find(r=>r.id===id);
  if(existing){if(existing.assetId!==asset.id||existing.postKind!==kind||existing.upstream?.id!==sourceId||(kind==='resolve'&&(existing.materialPackage?.id||undefined)!==(materialPackageId||undefined)))throw Error('此版本编号已使用，请重新打开登记窗口。');return {project,row:existing,created:false};}
  const upstream=kind==='ae'?postVersions(project,'resolve').find(r=>r.id===sourceId):null;
  if(kind==='ae'&&!upstream)throw Error('请为 AE 包装版本选择达芬奇底片。');
  const packet=kind==='resolve'&&materialPackageId?materialPackages(project).find(p=>p.id===materialPackageId):null;
  if(materialPackageId&&!packet)throw Error('素材交接批次已不存在，请重新选择。');
  const lineage=kind==='ae'?upstream.materialPackage:packet?packageSnapshot(packet):undefined;
  const versionNumber=Math.max(0,...postVersions(project,kind).map(r=>r.versionNumber||0))+1;
  const row={id,source:'postproduction',stage:kind==='ae'?'finish':'edit',postKind:kind,versionNumber,title:postLabel(kind),version:'第 '+versionNumber+' 版',software:kind==='ae'?'After Effects':'DaVinci Resolve',assetId:asset.id,media:{name:asset.name,size:asset.size,mime:asset.mime,sha256:asset.sha256},path:'工作台项目文件 · '+asset.name,projectPath,note,status:'待复核',date:new Date(now).toISOString(),...(upstream?{upstream:postSnapshot(upstream)}:{}),...(lineage?{materialPackage:lineage}:{})};
  return {project:{...project,stageEntries:[...rows,row],updatedAt:now},row,created:true};
}
function appendPostDelivery(project,sourceId,now=Date.now()){
  const source=postVersions(project).find(r=>r.id===sourceId);
  if(!source||source.status!=='已确认')throw Error('请先播放检查并将所选成片标记为已确认。');
  const rows=project.stageEntries||[],id='delivery-'+source.id,existing=rows.find(r=>r.id===id);
  if(existing)return {project:{...project,stage:'delivery'},row:existing,created:false};
  const row={id,source:'post-delivery',stage:'delivery',title:'交付成片',version:source.title+' · '+source.version,software:source.software,assetId:source.assetId,media:{...source.media},path:source.path,upstream:postSnapshot(source),...(source.materialPackage?{materialPackage:source.materialPackage}:{}),bypassedAE:source.postKind==='resolve',status:'待交付',note:source.postKind==='resolve'?'本次不需要 AE 包装，采用已确认的达芬奇成片。':'采用已确认的 AE 包装成片。',date:new Date(now).toISOString()};
  return {project:{...project,stage:'delivery',stageEntries:[...rows,row],updatedAt:now},row,created:true};
}
