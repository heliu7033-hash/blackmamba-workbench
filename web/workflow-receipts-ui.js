'use strict';
function persistWorkflowProject(project){return persist(items.map(p=>p.id===project.id?project:p));}
function workflowCopyPanel(project){
  const box=el('section','workflow-receipt'),copy=activeCopyReceipt(project),drafts=savedCopyDrafts(project),latest=drafts.filter(r=>r.status==='已确认').at(-1);
  box.append(el('small','action-label','来自创意方案'),el('h3','',copy?'已接收 · '+copy.draft.title:'等待接收已确认文案'));
  if(copy){const details=el('details');details.open=true;details.append(el('summary','','本次制作使用的完整文案'),el('p','stage-text receipt-copy',copy.draft.note));box.append(details);
    const current=drafts.find(r=>r.id===copy.draft.id);if(!current||current.status!=='已确认'||current.note!==copy.draft.note)box.append(el('p','receipt-warning','上游文案已修改或撤回确认，当前快照保留，请重新核对。'));
  }else box.append(el('p','study-note','在创意方案确认文案后，这里会自动接收正文，用于分镜与素材制作。'));
  const actions=el('div','post-actions');
  if(latest&&(!copy||latest.id!==copy.draft.id||latest.note!==copy.draft.note)){box.append(el('p','receipt-warning',latest.title+'已确认，等待接收。现有素材和旧分镜会保留原稿来源。'));actions.append(button('接收 '+latest.title,()=>{try{const current=items.find(p=>p.id===project.id);if(persistWorkflowProject(receiveWorkflowCopy(current,latest.id)))toast('新文案已接收，请按新稿重新讨论分镜');}catch(e){toast(e.message);}},'primary'));}
  if(!latest&&drafts.length)actions.append(button('确认文案并交给素材制作',()=>showStageOutput(project,drafts.at(-1)),'primary'));
  actions.append(button('查看上游方案',()=>openWorkflowStage(project,'brief')));box.append(actions);return box;
}
function materialPackagePanel(project){
  const panel=el('section','workflow-receipt'),packets=materialPackages(project),latest=packets.at(-1);
  panel.append(el('small','action-label','来自素材制作'),el('h3','',latest?'已接收 · '+latest.title:'等待素材交接'));
  if(!latest){panel.append(el('p','study-note','在素材制作中确认并勾选本次剪辑要用的文件，再点击「交给剪辑后期」。'),button('去接收文案和整理素材',()=>openWorkflowStage(project,'preproduction'),'primary'));return panel;}
  function packetView(packet){const section=el('section');section.append(el('p','',packet.copyDraft.title+' → '+packet.title+' · '+packet.assets.length+' 个文件'));
    const files=el('div','receipt-files');for(const a of packet.assets){const row=el('div','receipt-file'),url=a.url||materialURL(project.id,'file',a.id);row.append(el('span','',a.name),button(a.kind==='image'?'查看':'播放',()=>openMediaViewer({name:a.name,kind:a.kind,url,filename:a.name})));const link=el('a','viewer-download','保存文件');link.href=url;link.download=a.name;row.append(link);files.append(row);}section.append(files);
    const actions=el('div','post-actions');actions.append(button('查看来源文案',()=>{const copy=copyReceipts(project).find(r=>r.id===packet.copyReceiptId);if(copy)showReceiptCopy(copy);}),button('下载交接清单',()=>downloadWorkflowManifest(project,packet)));section.append(actions);return section;}
  panel.append(packetView(latest));if(packets.length>1){const old=el('details');old.append(el('summary','','历史交接批次 · '+(packets.length-1)));for(const p of packets.slice(0,-1).reverse())old.append(packetView(p));panel.append(old);}
  panel.append(button('返回素材制作',()=>openWorkflowStage(project,'preproduction')));return panel;
}
function showReceiptCopy(copy){const dialog=el('dialog','output-dialog');dialog.setAttribute('aria-label','交接文案 '+copy.draft.title);dialog.append(el('h2','',copy.draft.title),el('p','stage-text',copy.draft.note),button('关闭',()=>dialog.close()));document.body.append(dialog);dialog.onclose=()=>dialog.remove();dialog.showModal();}
function downloadWorkflowManifest(project,packet){const copy=copyReceipts(project).find(r=>r.id===packet.copyReceiptId),blob=new Blob([JSON.stringify({project:project.name,packet,copy:copy?.draft},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=packet.title+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function workflowTracePanel(project,row){const {packet,copy,versions}=workflowTrace(project,row),box=el('div','receipt-trace');
  if(packet){box.append(el('p','',copy?.draft.title+' → '+packet.title+' → '+versions.map(outputTitle).join(' → ')));if(copy)box.append(button('追溯来源文案',()=>showReceiptCopy(copy)),button('下载素材交接清单',()=>downloadWorkflowManifest(project,packet)));}
  else box.append(el('small','study-note','历史版本尚未关联素材交接批次。'));return box;
}
function aeInputPanel(project){const box=el('div','workflow-receipt'),active=activeAeInput(project),latest=postVersions(project,'resolve').filter(r=>r.status==='已确认').at(-1);
  box.append(el('small','action-label','来自达芬奇剪辑调色'));
  if(active){const row=postVersions(project,'resolve').find(r=>r.id===active.id);box.append(el('p','','已接收底片 · '+active.version));if(row){box.append(button('播放底片',()=>openMediaViewer(postMedia(project,row))));const a=el('a','viewer-download','保存底片');a.href=postMedia(project,row).url;a.download=row.media?.name||'base.mp4';box.append(a);if(row.status!=='已确认')box.append(el('p','receipt-warning','此底片已撤回确认，请核对后继续包装。'));}}
  else box.append(el('p','study-note','达芬奇版本确认后，底片会在这里接收。'));
  if(latest&&latest.id!==active?.id)box.append(button('接收新底片 · '+latest.version,()=>{try{if(persistWorkflowProject(receiveAeInput(items.find(p=>p.id===project.id),latest.id)))toast('新底片已接收，已有 AE 版本仍保留原关联');}catch(e){toast(e.message);}}));return box;
}
