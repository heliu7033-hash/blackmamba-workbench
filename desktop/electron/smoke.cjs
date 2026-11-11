async function browserCheck({phase,video}){
  const check=(value,label)=>{if(!value)throw Error(label);};
  check(typeof require==='undefined'&&typeof process==='undefined','renderer isolation');
  check(typeof window.mambaDesktop?.chooseFolders==='function','preload bridge');
  const id='windows-smoke';
  const api=async(route,options)=>{const response=await fetch('/api/materials/projects/'+id+route,options);if(!response.ok)throw Error(await response.text());return response.json();};
  if(phase==='read'){
    const p=items.find(p=>p.id===id);
    check(p&&activeCopyReceipt(p).draft.note==='用于验收的虚构文案','project persisted');
    check(workflowTrace(p,p.stageEntries.find(r=>r.stage==='delivery')).copy.draft.note==='用于验收的虚构文案','lineage persisted');
    check((await api('')).assets.length===3,'media persisted');
    return {passed:true,phase,checks:['restart','project','media','lineage']};
  }
  check(items.length===0,'empty first launch');
  let p={id,name:'Windows 中文路径验收',type:'项目',status:'进行中',stage:'brief',client:'',owner:'',due:'',url:'',notes:'虚构测试',checks:{}};
  p=appendCopyDraft(p,{id:'smoke',draft:'用于验收的虚构文案'}).project;
  p.stageEntries[0].status='已确认';check(persist([p]),'save project');p=items[0];
  document.querySelector('[data-project="'+id+'"]').click();
  check(document.querySelector('#workflow-board').children.length===4,'four workflow branches');
  inspectedStage='preproduction';navigate('阶段');
  check(document.body.textContent.includes('已接收 · 文案第 1 稿'),'copy inbox');
  const bytes=encoded=>Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
  const upload=async(name,body,purpose='')=>api('/upload/'+crypto.randomUUID(),{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(name),'X-Category':encodeURIComponent('参考素材'),'X-Purpose':purpose},body});
  const png=bytes('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=');
  let a=await upload('中文 分镜 100%.png',png),state=await api('');
  a=await api('/asset/'+a.id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:state.revision,category:'分镜图',status:'已确认',shot:1})});
  const image=new Image();image.src='/api/materials/projects/'+id+'/file/'+a.id;await image.decode();
  p=createMaterialPackage(p,[a],[a.id]).project;
  const cut=await upload('剪辑 成片.mp4',bytes(video),'resolve-export');
  p=appendPostVersion(p,{id:'resolve-smoke',kind:'resolve',asset:cut,materialPackageId:materialPackages(p)[0].id}).project;
  p.stageEntries.find(r=>r.id==='resolve-smoke').status='已确认';
  const ae=await upload('包装 成片.mp4',bytes(video),'ae-export');
  p=appendPostVersion(p,{id:'ae-smoke',kind:'ae',asset:ae,sourceId:'resolve-smoke'}).project;
  p.stageEntries.find(r=>r.id==='ae-smoke').status='已确认';p=appendPostDelivery(p,'ae-smoke').project;
  check(workflowTrace(p,p.stageEntries.at(-1)).copy.draft.note==='用于验收的虚构文案','delivery lineage');check(persist([p]),'persist lineage');
  const player=document.createElement('video');player.muted=true;player.src='/api/materials/projects/'+id+'/file/'+cut.id;document.body.append(player);
  await Promise.race([player.play(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Video decode timeout')),10000))]);player.pause();player.remove();
  document.querySelector('#command-trigger').click();check(document.querySelector('#command-palette').open,'command palette');
  return {passed:true,phase,checks:['empty state','workflow','copy receipt','Chinese filename','image decoding','video playback','material package','Resolve','AE','delivery','renderer isolation']};
}
exports.run=async(main,phase)=>{
  const video=phase==='write'?require('node:fs').readFileSync(process.env.MAMBA_SMOKE_VIDEO).toString('base64'):'';
  return main.webContents.executeJavaScript('('+browserCheck.toString()+')('+JSON.stringify({phase,video})+')');
};
