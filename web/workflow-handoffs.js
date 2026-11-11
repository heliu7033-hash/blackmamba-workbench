'use strict';
function copyReceipts(project){return project.workflowHandoffs?.copies||[];}
function activeCopyReceipt(project){const copies=copyReceipts(project);return copies.find(r=>r.id===project.workflowHandoffs?.activeCopyId)||copies.at(-1);}
function receiveWorkflowCopy(project,draftId,now=Date.now()){
  const draft=savedCopyDrafts(project).find(r=>r.id===draftId);if(!draft||draft.status!=='已确认')throw Error('请先确认要交给素材制作的文案。');
  if(!draft.note?.trim())throw Error('该文案没有正文，无法交接。');
  const handoffs=project.workflowHandoffs||{},copies=copyReceipts(project),old=copies.find(r=>r.draft.id===draft.id&&r.draft.note===draft.note);
  const receipt=old||{id:'copy-receipt-'+draft.id+'-'+copies.length,receivedAt:now,draft:{id:draft.id,title:draft.title,draftNumber:draft.draftNumber,note:draft.note,date:draft.date}};
  return {...project,workflowHandoffs:{...handoffs,copies:old?copies:[...copies,receipt],activeCopyId:receipt.id},updatedAt:now};
}
function initializeWorkflowReceipts(project){
  if(!activeCopyReceipt(project)){
    const draft=savedCopyDrafts(project).filter(r=>r.status==='已确认'&&r.note?.trim()).at(-1);
    if(draft)project=receiveWorkflowCopy(project,draft.id,Number(project.updatedAt)||Date.parse(draft.date)||0);
  }
  if(!activeAeInput(project)){const source=postVersions(project,'resolve').filter(r=>r.status==='已确认').at(-1);if(source)project=receiveAeInput(project,source.id);}
  return project;
}
function activeAeInput(project){return project.workflowHandoffs?.aeInput;}
function receiveAeInput(project,sourceId){const row=postVersions(project,'resolve').find(r=>r.id===sourceId);if(!row||row.status!=='已确认')throw Error('请先确认达芬奇底片。');return {...project,workflowHandoffs:{...project.workflowHandoffs,aeInput:postSnapshot(row)}};}
function materialPackages(project){return project.workflowHandoffs?.materials||[];}
function createMaterialPackage(project,assets,selectedIds,now=Date.now()){
  const copy=activeCopyReceipt(project);if(!copy)throw Error('请先接收已确认文案。');
  const current=savedCopyDrafts(project).find(r=>r.id===copy.draft.id);if(!current||current.status!=='已确认'||current.note!==copy.draft.note)throw Error('当前接收文案已变更或撤回确认，请先核对上游文案。');
  const ids=[...new Set(selectedIds)];if(!ids.length)throw Error('请至少选择一项已确认素材。');if(ids.length>500)throw Error('单次交接最多 500 项素材。');
  const files=ids.map(id=>{const a=assets.find(a=>a.id===id);if(!a||a.purpose||a.status!=='已确认')throw Error('所选素材已变更，请刷新并确认后再交接。');return {id:a.id,name:a.name,kind:a.kind,mime:a.mime,sha256:a.sha256,size:a.size,shot:a.shot||0,category:a.category,sourceDraft:a.sourceDraft,url:a.legacy?a.url:undefined,legacy:!!a.legacy};});
  const packages=materialPackages(project),same=packages.find(p=>p.copyReceiptId===copy.id&&JSON.stringify(p.assets)===JSON.stringify(files));
  if(same)return {project,packet:same,created:false};
  const number=Math.max(0,...packages.map(p=>p.number))+1,packet={id:'materials-'+number,number,title:'素材交接第 '+number+' 批',copyReceiptId:copy.id,copyDraft:{id:copy.draft.id,title:copy.draft.title},assets:files,createdAt:now};
  return {project:{...project,workflowHandoffs:{...project.workflowHandoffs,materials:[...packages,packet]},updatedAt:now},packet,created:true};
}
function packageSnapshot(packet){return packet?{id:packet.id,title:packet.title,copyReceiptId:packet.copyReceiptId,copyDraft:{...packet.copyDraft}}:undefined;}
function workflowTrace(project,row){
  const packetId=row.materialPackage?.id||row.upstream?.materialPackage?.id;
  const packet=materialPackages(project).find(p=>p.id===packetId),copy=copyReceipts(project).find(r=>r.id===packet?.copyReceiptId);
  const versions=[],seen=new Set();let current=row;
  while(current&&!seen.has(current.id)){seen.add(current.id);versions.unshift(current);current=(project.stageEntries||[]).find(r=>r.id===current.upstream?.id);}
  return {packet,copy,versions};
}
