'use strict';
const materialCategories=['分镜图','实拍素材','参考素材','声音','其他'];
function materialURL(project,action='',id=''){return '/api/materials/projects/'+encodeURIComponent(project)+[action,id].filter(Boolean).map(s=>'/'+encodeURIComponent(s)).join('');}
async function materialAPI(project,action='',id='',body){const r=await fetch(materialURL(project,action,id),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const d=await r.json();if(!r.ok)throw Error(d.error||'素材服务不可用');return d;}
function openMediaViewer({name,kind,url,fallback,filename}){
  const dialog=el('dialog','material-viewer'),header=el('div','viewer-header'),media=el(kind==='image'?'img':kind),note=el('p','study-note');dialog.setAttribute('aria-label',name);
  header.append(el('strong','',name));if(kind==='image')media.alt=name;else{media.controls=true;media.preload='metadata';media.setAttribute('playsinline','');}
  media.src=url;let compatible=false;
  media.onerror=()=>{note.textContent='此文件暂不能播放或已经离线。';if(fallback&&!compatible){compatible=true;note.textContent='正在准备兼容预览…';media.src=fallback;media.load();}};
  if(kind==='video')header.append(button('全屏播放',()=>{if(media.requestFullscreen)media.requestFullscreen().catch(()=>{note.textContent='全屏未开启，可继续在大屏窗口播放。';});else if(media.webkitEnterFullscreen)media.webkitEnterFullscreen();}));
  const download=el('a','viewer-download','保存文件');download.href=url;download.download=(filename||name).replace(/[\\/:*?"<>|]/g,'-');header.append(download,button('关闭',()=>dialog.close()));dialog.append(header,media,note);document.body.append(dialog);
  dialog.onclose=()=>{if(kind!=='image'){media.pause();media.removeAttribute('src');media.load();}dialog.remove();};dialog.showModal();
  if(kind!=='image')void media.play().catch(()=>{note.textContent='点击播放按钮开始播放。';});return dialog;
}
function materialsStudio(project){
  const panel=el('section','materials-studio'),nav=el('div','materials-tabs'),gallery=el('div'),chat=el('div'),notice=el('p','materials-notice');notice.setAttribute('role','status');
  const libraryTab=button('项目素材',()=>switchTab(false),'primary'),chatTab=button('分镜智能体',()=>switchTab(true));nav.append(libraryTab,chatTab);
  panel.append(nav,notice,gallery,chat);chat.hidden=true;
  let state={assets:[],jobs:[],revision:0},timer,chatMounted=false,loadVersion=0,source='all',category='all',kind='all',status='all',shotFilter='all';
  const sourceRows=savedCopyDrafts(project),sources=[...sourceRows.map(r=>({id:r.id,title:r.title+' · '+r.status,text:r.note,status:r.status})),...(project.notes?[{id:'project-brief',title:'项目原始简报',text:project.notes}]:[])];
  const received=activeCopyReceipt(project);
  if(received){const i=sources.findIndex(s=>s.id===received.draft.id),snapshot={id:received.draft.id,title:received.draft.title+' · 已接收',text:received.draft.note,status:'已确认'};if(i>=0)sources[i]=snapshot;else sources.push(snapshot);}
  let selectedSource=received?.draft.id||sourceRows.filter(r=>r.status==='已确认').at(-1)?.id||sourceRows.at(-1)?.id||sources[0]?.id;
  function switchTab(isChat){gallery.hidden=isChat;chat.hidden=!isChat;libraryTab.classList.toggle('primary',!isChat);chatTab.classList.toggle('primary',isChat);libraryTab.setAttribute('aria-pressed',String(!isChat));chatTab.setAttribute('aria-pressed',String(isChat));if(isChat&&!chatMounted)mountChat();}
  function mountChat(){chatMounted=true;chat.replaceChildren();if(!sources.length){chat.append(el('p','','先在创意方案保存文案，或填写项目简报，再来拆分镜头。'),button('去写文案',()=>openWorkflowStage(project,'brief')));return;}
    const label=el('label','material-source','文案来源 '),select=el('select');select.setAttribute('aria-label','分镜文案来源');for(const s of sources)select.append(new Option(s.title,s.id));select.value=selectedSource;select.disabled=!!received;label.append(select);
    const info=el('p','study-note','优先选用已确认稿。更换来源后，请发送补充重新讨论；已经生成的图片仍保留原稿关联。'),host=el('div');chat.append(label,info,host);
    function renderChat(){const s=sources.find(s=>s.id===selectedSource);info.textContent=received?'使用上方已接收文案。上游改稿后，请先接收新版，再按提示重新讨论。':(s.status==='已确认'?'已选已确认文案。':'当前来源尚未确认，可先做测试分镜。')+' 更换来源后发送补充，会重新讨论镜头方向。';host.replaceChildren(creativeChatPanel({...project,notes:s.text,sourceId:s.id,sourceTitle:s.title},{mode:'materials',renderPlan}));}
    select.onchange=()=>{selectedSource=select.value;renderChat();};renderChat();
  }
  function renderPlan(target,draft){
    if(!draft.plan)return;const details=el('details','material-plan');details.open=true;details.append(el('summary','','核对镜头表 · '+draft.plan.shots.length+' 镜 · '+(draft.sourceDraft?.title||'来源待核实')));
    const stored=(window.MambaShotEdits ||= new Map()),key=project.id+':'+draft.id,plan=stored.get(key)||structuredClone(draft.plan);stored.set(key,plan);
    const style=el('textarea');style.value=plan.style;style.rows=2;style.maxLength=1500;style.setAttribute('aria-label','统一画面风格');style.oninput=()=>plan.style=style.value;const ratio=el('select');ratio.setAttribute('aria-label','分镜画幅');for(const r of ['16:9','9:16','1:1','4:3'])ratio.append(new Option(r,r));ratio.value=plan.ratio;ratio.onchange=()=>plan.ratio=ratio.value;details.append(el('label','','统一风格'),style,ratio);
    const shots=el('div','material-plan-shots');plan.shots.forEach((s,i)=>{const item=el('section');item.append(el('strong','','镜头 '+(i+1)));for(const [k,label,max] of [['action','画面与动作',650],['prompt','出图提示词',2000]]){const wrap=el('label','',label),field=el('textarea');field.rows=k==='prompt'?3:2;field.maxLength=max;field.value=s[k];field.oninput=()=>s[k]=field.value;wrap.append(field);item.append(wrap);}shots.append(item);});details.append(shots);
    const provider=el('select');provider.setAttribute('aria-label','分镜出图服务');const row=el('div','material-plan-controls'),message=el('p','study-note');let sending=false,requestId;
    async function agents(){const r=await fetch('/api/materials/agents');const list=await r.json();if(!r.ok)throw Error(list.error);provider.replaceChildren(...list.map(a=>new Option(a.name+(a.available===false?' · 未安装':''),a.id)));}
    const submit=button('确认镜头表并生成图片',async()=>{
      if(sending)return;sending=true;submit.disabled=true;message.textContent='正在提交出图任务…';requestId ||= crypto.randomUUID();
      try{await materialAPI(project.id,'generate',requestId,{consent:true,planId:draft.id,plan,providerId:provider.value});requestId=undefined;await refresh();switchTab(false);}
      catch(e){message.textContent=e.message;}finally{sending=false;submit.disabled=false;}
    },'primary');
    row.append(provider,button('接入 MCP 出图服务',()=>configureCreativeAgent(agents,{apiRoot:'/api/materials',image:true})),submit);details.append(row,el('p','study-note','点击生成才调用出图服务，可能消耗所选服务额度。每镜生成一张，完成后自动进入项目素材。本机 Codex 使用首镜作连续性参考；通用 MCP 接入使用文字风格约束。'),message);target.append(details);void agents().catch(e=>{message.textContent=e.message;submit.disabled=true;});
  }
  const selection=new Set();
  const controls=el('div','material-toolbar'),picker=el('input');picker.type='file';picker.multiple=true;picker.accept='image/png,image/jpeg,image/webp,image/gif,video/*,audio/*';picker.hidden=true;
  const importButton=button('＋ 导入本地素材',()=>picker.click(),'primary');controls.append(importButton,picker);gallery.append(controls);
  const handoff=el('div','material-handoff'),selectionNote=el('span','','选择已确认素材交给剪辑'),sendMaterials=button('交给剪辑后期',async()=>{sendMaterials.disabled=true;try{if(await refresh()!==true)throw Error('无法核对最新素材，请重试读取后交接');const current=items.find(p=>p.id===project.id);if(!current)throw Error('项目已不存在');const result=createMaterialPackage(current,state.assets,[...selection]);const next={...result.project};if(['brief','preproduction'].includes(phaseFor(next.stage)?.id))next.stage='edit';if(persistWorkflowProject(next)){openWorkflowStage(next,'edit');toast(result.packet.title+'已接收，可查看文件并关联剪辑版本');}}catch(e){notice.textContent=e.message;}finally{sendMaterials.disabled=false;}},'primary');handoff.append(selectionNote,sendMaterials);gallery.append(handoff);
  const filters=el('div','material-filters');function filter(label,values,change){const input=el('select');input.setAttribute('aria-label',label);for(const [value,name] of values)input.append(new Option(name,value));input.onchange=()=>{change(input.value);draw();};filters.append(input);}
  filter('素材来源',[['all','全部来源'],['generated','智能体生成'],['local','本地导入']],v=>source=v);
  filter('素材分类',[['all','全部分类'],...materialCategories.map(v=>[v,v])],v=>category=v);
  filter('素材类型',[['all','全部类型'],['image','图片'],['video','视频'],['audio','音频']],v=>kind=v);
  filter('素材状态',[['all','全部状态'],...['待复核','已确认','需修改'].map(v=>[v,v])],v=>status=v);
  const shotSelect=el('select');shotSelect.setAttribute('aria-label','镜头筛选');shotSelect.onchange=()=>{shotFilter=shotSelect.value;draw();};filters.append(shotSelect);
  const jobs=el('div','material-jobs'),grid=el('div','material-grid');gallery.append(jobs,filters,grid);
  picker.onchange=()=>{if(picker.files.length)importFiles(Array.from(picker.files));};
  function importFiles(files){
    const dialog=el('dialog','material-import-dialog');dialog.setAttribute('aria-label','导入本地素材');const form=el('form'),select=el('select');select.setAttribute('aria-label','导入素材分类');materialCategories.forEach(c=>select.append(new Option(c,c)));select.value='实拍素材';const note=el('p','study-note'),list=el('p','stage-text',files.map(f=>f.name).join('\n'));
    const records=files.map(file=>({file,id:crypto.randomUUID(),done:false}));const submit=el('button','primary','导入 '+files.length+' 个文件');submit.type='submit';const close=button('关闭',()=>dialog.close());
    form.append(el('h2','','导入本地素材'),el('p','','复制到当前项目的本机素材目录，原文件保留。每个文件最多 512 MB；同项目相同内容自动去重。'),list,select,note,submit,close);dialog.append(form);document.body.append(dialog);dialog.onclose=()=>{dialog.remove();picker.value='';};dialog.showModal();
    form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;close.disabled=true;select.disabled=true;importButton.disabled=true;let errors=0;dialog.oncancel=e=>e.preventDefault();
      for(const [i,entry] of records.entries()){if(entry.done)continue;note.textContent='正在导入 '+(i+1)+' / '+records.length+'：'+entry.file.name;
        try{if(entry.file.size>512*1024*1024)throw Error('文件超过 512 MB，请使用工具素材库按目录索引');const r=await fetch(materialURL(project.id,'upload',entry.id),{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(entry.file.name),'X-Category':encodeURIComponent(select.value)},body:entry.file});const result=await r.json();if(!r.ok)throw Error(result.error);entry.done=true;}
        catch(err){entry.error=err.message;errors++;}}
      await refresh();importButton.disabled=false;close.disabled=false;select.disabled=false;submit.disabled=false;dialog.oncancel=null;
      if(!errors){dialog.close();notice.textContent='本地素材已导入，重复内容已去重。';}else{note.textContent=records.filter(r=>!r.done).map(r=>r.file.name+'：'+r.error).join('\n');submit.textContent='重试未完成文件';}
    };
  }
  function editAsset(a){const dialog=el('dialog','material-import-dialog'),form=el('form');dialog.setAttribute('aria-label','素材分类与状态');const cat=el('select'),status=el('select'),shot=el('input');cat.name='category';status.name='status';shot.name='shot';shot.type='number';shot.min=0;shot.max=999;shot.value=a.shot||0;materialCategories.forEach(c=>cat.append(new Option(c,c)));cat.value=a.category;['待复核','已确认','需修改'].forEach(c=>status.append(new Option(c,c)));status.value=a.status;
    const save=el('button','primary','保存分类与状态');save.type='submit';form.append(el('h2','',a.name));for(const [name,field] of [['分类',cat],['状态',status],['关联镜号（0 为未关联）',shot]]){const l=el('label','',name);l.append(field);form.append(l);}const err=el('p');form.append(err,save,button('取消',()=>dialog.close()));dialog.append(form);document.body.append(dialog);dialog.onclose=()=>dialog.remove();dialog.showModal();const revision=state.revision;
    form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{await materialAPI(project.id,'asset',a.id,{category:cat.value,status:status.value,shot:Number(shot.value),revision});dialog.close();await refresh();}catch(e){err.textContent=e.message;}finally{save.disabled=false;}};
  }
  function draw(){
    selectionNote.textContent='已选 '+selection.size+' 项 · 仅已确认素材可交接';
    shotSelect.replaceChildren(new Option('全部镜头','all'),new Option('未关联镜头','0'),...[...new Set(state.assets.map(a=>a.shot).filter(n=>n>0))].sort((a,b)=>a-b).map(n=>new Option('镜头 '+n,String(n))));shotSelect.value=shotFilter;
    jobs.replaceChildren();for(const j of state.jobs.slice().reverse().slice(0,4)){const box=el('div','material-job');box.append(el('strong','',(j.sourceDraft?.title||'分镜')+' · '+j.assetIds.length+'/'+j.plan.shots.length+' 张'),el('span','',j.message));if(['partial','failed','interrupted'].includes(j.status))box.append(button('继续未完成镜头',async()=>{try{await materialAPI(project.id,'resume',j.id,{consent:true});await refresh();}catch(e){notice.textContent=e.message;}}));jobs.append(box);}
    grid.replaceChildren();const all=state.assets.filter(a=>(source==='all'||a.source===source)&&(category==='all'||a.category===category)&&(kind==='all'||a.kind===kind)&&(status==='all'||a.status===status)&&(shotFilter==='all'||(a.shot||0)===Number(shotFilter))).slice().reverse();
    for(const a of all){const card=el('article','material-card'),open=button('',()=>openMediaViewer({name:a.name,kind:a.kind,url:a.url||materialURL(project.id,'file',a.id),filename:a.source==='generated'&&a.file?'分镜-'+(a.shot||a.id)+'.'+a.file.split('.').at(-1):a.name}),'material-art');open.setAttribute('aria-label',(a.kind==='video'?'大屏播放 ':a.kind==='audio'?'播放 ':'查看 ')+a.name);
      if(a.kind==='image'){const img=el('img');img.loading='lazy';img.src=a.url||materialURL(project.id,'file',a.id);img.alt=a.name;open.append(img);}else if(a.kind==='video'){const video=el('video');video.muted=true;video.preload='metadata';video.setAttribute('playsinline','');video.src=(a.url||materialURL(project.id,'file',a.id))+'#t=0.1';open.append(video,el('span','material-play','▶ 大屏播放'));}else open.append(el('span','material-play','♫ 播放音频'));
      const choice=el('label','material-select'),check=el('input');check.type='checkbox';check.checked=selection.has(a.id);check.disabled=a.status!=='已确认';check.setAttribute('aria-label','交接 '+a.name);check.onchange=()=>{if(check.checked)selection.add(a.id);else selection.delete(a.id);selectionNote.textContent='已选 '+selection.size+' 项 · 仅已确认素材可交接';};choice.append(check,el('span','',a.status==='已确认'?'交给剪辑':'确认后可交接'));card.append(choice);
      card.append(open,el('strong','',a.name),el('small','',[a.category,a.source==='generated'?'智能体生成':'本地导入',a.shot?'镜头 '+a.shot:null,a.status].filter(Boolean).join(' · ')));
      if(a.sourceDraft){const current=sourceRows.find(r=>r.id===a.sourceDraft.id);card.append(el('small','',a.sourceDraft.title+(current&&current.id!==sourceRows.at(-1)?.id?' · 有更新文案，请核对':'')));}
      card.append(button(a.legacy?'查看旧版分镜':'分类与状态',()=>{if(!a.legacy)return editAsset(a);const box=panel.parentElement.querySelector('.legacy-storyboards');if(box){let parent=box;while(parent){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}box.scrollIntoView({block:'start'});}}));grid.append(card);
    }
    if(!all.length)grid.append(el('p','material-empty',state.assets.length?'没有符合筛选的素材。':'还没有项目素材。可导入本地文件，或与分镜智能体讨论后生成图片。'));
  }
  async function refresh(){clearTimeout(timer);const n=++loadVersion;try{const [d,older]=await Promise.all([materialAPI(project.id),boardAPI(project.id).catch(()=>[])]);if(!panel.isConnected||n!==loadVersion)return;const legacy=older.flatMap((v,i)=>[...v.shots.filter(s=>s.file).map(s=>({id:v.id+'-'+s.number,name:'旧版分镜 V'+(older.length-i)+' · 镜头 '+s.number,kind:'image',category:'分镜图',source:'generated',shot:s.number,status:v.confirmedAt?'已确认':'待复核',legacy:true,url:storyboardURL(project.id,v.id,s.file)})),...(v.video?[{id:v.id+'-video',name:'动态分镜 V'+(older.length-i),kind:'video',category:'分镜图',source:'generated',status:'待复核',legacy:true,url:storyboardURL(project.id,v.id,v.video.file)}]:[])]);state={...d,assets:[...legacy.reverse(),...d.assets.filter(a=>!a.purpose)]};draw();notice.textContent='项目素材 '+state.assets.length+' 项 · 图片和视频保存在本机项目目录';if(d.jobs.some(j=>j.status==='running'))timer=setTimeout(()=>{if(panel.isConnected)refresh().catch(()=>{});},2000);return true;}catch(e){notice.textContent=e.message;notice.append(' ',button('重新读取',refresh));return false;}}
  switchTab(false);queueMicrotask(()=>refresh().catch(()=>{}));return panel;
}

async function hydrateMaterialBranch(project,node){try{const d=await materialAPI(project.id);d.assets=d.assets.filter(a=>!a.purpose);if(!node.isConnected)return;if(!d.assets.length){const copy=activeCopyReceipt(project);if(copy)node.replaceChildren(el('strong','','已接收 '+copy.draft.title),el('small','','开始分镜和素材制作 →'));node.onclick=()=>openWorkflowStage(project,'preproduction');return;}const latest=d.assets.at(-1);node.replaceChildren(el('strong','','项目素材 · '+d.assets.length+' 项'),el('small','',latest.name+' · '+latest.status+' →'));node.onclick=()=>openWorkflowStage(project,'preproduction');}catch{/* Existing local records stay visible if the service is offline. */}}
