(() => {
 'use strict';
 const $=s=>document.querySelector(s), node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
 const kinds={video:'视频',audio:'音频',image:'图片'};
 let locked=false;
 let waveformObserver=null,waveformQueue=[],waveformActive=0;
 let activeRoot='',activeFolder='',trees=[],knownRoots='',wasScanning=false,folderEpoch=0;
 const expanded=new Set();
 let hoverTimer,hoverMedia=null,hoverCard=null,hoverVersion=0;

 let page=0,selected=null,connection=null,loading=false,importing=false,scanTimer,searchTimer,epoch=0,previewEpoch=0,lastPage,started=false,thumbEpoch=0;
 async function api(route,body){const r=await fetch('/api/media/'+route,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});let data;try{data=await r.json();}catch{throw Error('请在本机黑曼巴工作台打开素材库');}if(!r.ok)throw Error(data.error||'请求失败');return data;}
 function message(text){$('#media-state').textContent=text;}
 function bytes(size){return size>1024**3?(size/1024**3).toFixed(1)+' GB':size>1024**2?(size/1024**2).toFixed(1)+' MB':Math.ceil(size/1024)+' KB';}
 function status(data){
  $('#media-count').textContent=data.scanning?`正在索引 · 已扫描 ${data.progress.toLocaleString()} 项`:`检索到 ${(lastPage?.total??data.total).toLocaleString()} 项`;
  $('#media-scan').disabled=data.scanning;
  $('#media-roots-save').disabled=data.scanning;
  locked=!!data.importLocked;$('#media-unlock').hidden=!locked;updateImport();
  $('#media-warnings').textContent=data.warnings?.slice(0,4).join('；')||'';
  if(knownRoots!==JSON.stringify(data.roots)||wasScanning&&!data.scanning){knownRoots=JSON.stringify(data.roots);void loadFolders();}wasScanning=data.scanning;
  if(document.activeElement!==$('#media-roots-input'))$('#media-roots-input').value=data.roots.join('\n');
  clearTimeout(scanTimer);if(data.scanning)scanTimer=setTimeout(()=>{if(!$('#media-view').hidden)search(false);},1300);
 }
 async function search(reset=true){
  if(reset)page=0;const version=++epoch;
  try{const query=new URLSearchParams({q:$('#media-query').value,kind:$('#media-kind').value,root:activeRoot,folder:activeFolder,page});const data=await api('search?'+query);if(version!==epoch)return;
   lastPage=data;page=data.page;status(data);$('#media-count').textContent=data.scanning?`正在索引 · 已扫描 ${data.progress.toLocaleString()} 项`:`检索到 ${data.total.toLocaleString()} 项`;
   $('#media-prev').disabled=page===0;$('#media-next').disabled=page+1>=data.pages;$('#media-page').textContent=data.pages?`${page+1} / ${data.pages}`:'0 / 0';
   stopHover();waveformObserver?.disconnect();waveformQueue=[];const list=$('#media-results');list.replaceChildren();const thumbs=[];
   for(const row of data.rows){const card=node('button',undefined,'media-card');card.type='button';card.dataset.id=row.id;card.setAttribute('aria-pressed',String(selected?.id===row.id));
    const art=node('div',undefined,'media-art');art.append(node('span',row.kind==='audio'?'♫':row.kind==='video'?'▷':'▧','media-placeholder'));
    if(row.kind==='audio')prepareWaveform(art,row);
    if(row.kind!=='audio'){const img=node('img');img.alt='';img.loading='lazy';img.onerror=()=>img.remove();art.append(img);if(row.kind==='image'&&/\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(row.name))img.src='/api/media/file?id='+row.id;else thumbs.push({img,id:row.id});}
    card.append(art,node('strong',row.displayName||row.name),node('span',kinds[row.kind]+' · '+bytes(row.size),'media-meta'),node('small',row.displayName&&row.displayName!==row.name?'原名：'+row.name:row.path.substring(row.root.length+1)||row.name));card.title=(row.displayName&&row.displayName!==row.name?row.displayName+'\n原名：'+row.name+'\n':'')+row.path;card.onclick=()=>{select(row);if(row.kind==='video')largePlayer(row);else if(row.kind==='audio')startHover(card,art,row,true);};card.onpointerenter=event=>{if(event.pointerType!=='touch')startHover(card,art,row);};card.onpointerleave=()=>{if(hoverCard===card)stopHover();};card.onblur=()=>{if(hoverCard===card&&!card.matches(':hover'))stopHover();};list.append(card);
   }
   const batch=++thumbEpoch;async function thumbnailQueue(){while(thumbs.length&&batch===thumbEpoch){const {img,id}=thumbs.shift();await new Promise(resolve=>{if(!img.isConnected)return resolve();img.onload=resolve;img.onerror=()=>{img.remove();resolve();};img.src='/api/media/thumbnail?id='+id;});}}void thumbnailQueue();void thumbnailQueue();
   if(!data.rows.length)list.append(node('p',data.scanning?'正在扫描文件夹，结果会自动出现。':data.roots.length?'没有匹配素材。可调整关键词、类型或目录，或重新扫描。':'添加素材文件夹后开始检索。','media-empty'));
  }catch(e){if(version===epoch)message(e.message);}
 }
 function prepareWaveform(art,row){
  art.classList.add('media-audio-art');art.replaceChildren(node('span','波形待加载','media-waveform-note'));
  if(!waveformObserver)waveformObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;waveformObserver.unobserve(entry.target);waveformQueue.push({art:entry.target,id:entry.target.dataset.audioId});}void runWaveforms();},{rootMargin:'100px'});
  art.dataset.audioId=row.id;waveformObserver.observe(art);
 }
 async function runWaveforms(){
  while(waveformActive<2&&waveformQueue.length){
   const item=waveformQueue.shift();if(!item.art.isConnected||$('#media-view').hidden)continue;
   waveformActive++;
   void (async()=>{const {art,id}=item,note=art.querySelector('.media-waveform-note');try{
    note.textContent='正在生成波形…';let response;
    for(let retry=0;retry<4;retry++){response=await fetch('/api/media/waveform?id='+id);if(response.status!==429)break;await new Promise(r=>setTimeout(r,800*(retry+1)));if(!art.isConnected)return;}
    const data=await response.json();if(!response.ok)throw Error(data.error);if(!art.isConnected)return;
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.classList.add('media-waveform');svg.setAttribute('viewBox','0 0 256 80');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('role','img');svg.setAttribute('aria-label',data.silent?'静音音频波形':'音频振幅波形');
    const baseline=document.createElementNS(ns,'path');baseline.setAttribute('d','M0 40H256');baseline.setAttribute('class','media-waveform-baseline');svg.append(baseline);
    const bars=document.createElementNS(ns,'path');bars.setAttribute('d',data.peaks.map((peak,i)=>`M${i*2+1} ${40-peak*36}v${peak*72}`).join(' '));svg.append(bars);note.remove();art.append(svg);
    const seconds=Math.round(data.duration),duration=node('span',`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}${data.silent?' · 静音':''}`,'media-waveform-duration');art.append(duration);
   }catch(e){if(art.isConnected){note.textContent='波形暂不可用';note.title=e.message;}}finally{waveformActive--;void runWaveforms();}})();
  }
 }
 async function loadFolders(){
  const version=++folderEpoch;
  try{const result=await api('directories');if(version!==folderEpoch)return;trees=result.trees;
   if(activeRoot&&!trees.some(tree=>tree.root===activeRoot)){activeRoot='';activeFolder='';void search();}
   const find=node=>node.path===activeFolder||node.children.some(find);const selectedTree=trees.find(tree=>tree.root===activeRoot);
   if(selectedTree&&activeFolder&&!find(selectedTree)){activeFolder=selectedTree.path;$('#media-current-folder').textContent=selectedTree.name;void search();}
   renderFolders();
  }catch(e){$('#media-folder-state').textContent=e.message;}
 }
 function chooseFolder(root='',folder=''){
  stopHover();activeRoot=root;activeFolder=folder;page=0;
  for(const button of document.querySelectorAll('.media-folder-name'))button.setAttribute('aria-current',String(button.dataset.root===root&&button.dataset.folder===folder));
  $('#media-all-folders').setAttribute('aria-current',String(!root));
  const tree=trees.find(t=>t.root===root);$('#media-current-folder').textContent=tree?tree.name+(folder===tree.path?'':' / '+folder.slice(tree.path.length+1).split('/').join(' / ')):'全部素材';
  void search();
 }
 function renderFolders(){
  const list=$('#media-directory-tree');list.replaceChildren();$('#media-folder-state').textContent=trees.length?'点击文件夹名称筛选，箭头展开子目录。':'尚未添加素材文件夹。';
  function branch(item){
   const li=node('li'),line=node('div',undefined,'media-folder-line'),key=JSON.stringify([item.root,item.path]);
   const toggle=node('button',expanded.has(key)?'▾':'▸','media-folder-toggle');toggle.type='button';toggle.disabled=!item.children.length;toggle.setAttribute('aria-label','展开或收起 '+item.name);toggle.setAttribute('aria-expanded',String(expanded.has(key)));
   const name=node('button',undefined,'media-folder-name');name.type='button';name.title=item.path;name.dataset.root=item.root;name.dataset.folder=item.path;name.setAttribute('aria-current',String(activeRoot===item.root&&activeFolder===item.path));name.append(node('span',item.name),node('small',item.count.toLocaleString()));name.onclick=()=>chooseFolder(item.root,item.path);
   const children=node('ul');children.hidden=!expanded.has(key);let rendered=false;
   function fill(){if(!rendered){children.append(...item.children.map(branch));rendered=true;}}
   if(!children.hidden)fill();toggle.onclick=()=>{const open=children.hidden;children.hidden=!open;toggle.textContent=open?'▾':'▸';toggle.setAttribute('aria-expanded',String(open));if(open){expanded.add(key);fill();}else expanded.delete(key);};
   line.append(toggle,name);li.append(line,children);return li;
  }
  list.append(...trees.map(branch));$('#media-all-folders').setAttribute('aria-current',String(!activeRoot));
 }
 function stopHover(){
  ++hoverVersion;clearTimeout(hoverTimer);
  if(hoverMedia){hoverMedia.pause();hoverMedia.removeAttribute('src');hoverMedia.load();hoverMedia.remove();hoverMedia=null;}
  if(hoverCard){hoverCard.classList.remove('is-previewing');hoverCard.querySelector('.media-hover-state')?.remove();hoverCard=null;}
 }
 function startHover(card,art,row,immediate=false){
  stopHover();hoverCard=card;const version=hoverVersion;
  const begin=()=>{
   if(version!==hoverVersion||!card.isConnected||$('#media-view').hidden)return;
   $('#media-player').querySelectorAll('video,audio').forEach(p=>p.pause());
   card.classList.add('is-previewing');
   if(row.kind==='image')return;
   const media=node(row.kind),label=node('span','正在预览…','media-hover-state');hoverMedia=media;media.className='media-hover-player';media.preload='auto';media.loop=true;media.muted=!$('#media-hover-sound').checked;media.volume=.5;media.setAttribute('playsinline','');
   const isCurrent=()=>version===hoverVersion&&hoverMedia===media;
   let compatible=false,attempting=false;
   const fail=text=>{if(isCurrent())label.textContent=text;};
   const play=()=>{if(!isCurrent()||attempting)return;attempting=true;Promise.resolve(media.play()).then(()=>{if(!isCurrent()){media.pause();return;}label.textContent=(row.kind==='audio'?'♫ 试听中':'▶ 预览中')+(media.muted?' · 静音':'');}).catch(e=>{if(!isCurrent())return;if(e.name==='NotAllowedError'){if(row.kind==='video'&&!media.muted){media.muted=true;attempting=false;play();}else fail('点击卡片开始试听');}else if(e.name!=='AbortError')fallback();}).finally(()=>{attempting=false;});};
   const fallback=()=>{if(!isCurrent())return;if(compatible){fail('此素材暂不能悬停播放');return;}compatible=true;attempting=false;label.textContent='正在准备短预览…';media.src='/api/media/file?id='+row.id+'&compatible=1&hover=1';media.load();play();};
   media.onerror=fallback;media.onloadeddata=()=>{if(isCurrent())play();};media.ontimeupdate=()=>{if(isCurrent()&&!media.paused)label.textContent=(row.kind==='audio'?'♫ ':'▶ ')+Math.floor(media.currentTime)+'s'+(media.muted?' · 静音':'')+(compatible?' · 短预览':'');};
   media.src='/api/media/file?id='+row.id;art.append(media,label);play();
  };
  if(immediate)begin();else hoverTimer=setTimeout(begin,280);
 }
 function updateImport(){const ready=selected&&connection?.ok&&connection.timelineId&&!importing&&!locked;
  $('#media-import').disabled=!ready;$('#media-import').textContent=importing?'正在写入达芬奇…':'导入达芬奇时间线';
  $('#media-video-track').disabled=!ready||selected.kind==='audio';$('#media-audio-track').disabled=!ready||selected.kind==='image'||selected.kind==='video'&&$('#media-video-mode').value==='video';$('#media-video-mode').disabled=!ready||selected.kind!=='video';
 }
 function largePlayer(row){stopHover();$('#media-player').querySelectorAll('video,audio').forEach(p=>p.pause());openMediaViewer({name:row.displayName||row.name,filename:row.name,kind:row.kind,url:'/api/media/file?id='+row.id,fallback:'/api/media/file?id='+row.id+'&compatible=1'});}
 function player(row,compatible=false){
  stopHover();
  const version=++previewEpoch,box=$('#media-player');box.querySelectorAll('video,audio').forEach(p=>{p.pause();p.removeAttribute('src');p.load();});box.replaceChildren();
  const tag=row.kind==='image'?'img':row.kind,media=node(tag);if(tag==='img')media.alt=row.displayName||row.name;else{media.controls=true;media.preload='metadata';media.setAttribute('playsinline','');}
  media.src='/api/media/file?id='+row.id+(compatible?'&compatible=1':'');box.append(media);$('#media-preview-note').textContent=compatible?'正在准备兼容预览，大文件可能需要几分钟…':'预览使用本地文件。';
  const loaded=()=>{if(version===previewEpoch)$('#media-preview-note').textContent=compatible?'兼容预览已就绪；导入仍使用原素材。':'原始素材预览';};media.onload=loaded;media.onloadedmetadata=loaded;
  media.onerror=()=>{if(version===previewEpoch)$('#media-preview-note').textContent=compatible?'兼容预览未成功，可能正在处理其他预览；稍后可重试。':'浏览器不支持此格式或素材离线。可尝试「兼容预览」。';};
 }
 function select(row){if(importing)return;selected=row;$('#media-detail').hidden=false;$('#media-selection-empty').hidden=true;$('#media-selected-name').textContent=row.displayName||row.name;$('#media-selected-path').textContent=row.path;$('#media-selected-kind').textContent=kinds[row.kind]+' · '+bytes(row.size)+(row.kind==='image'?' · 导入时长 5 秒':'');
  for(const el of document.querySelectorAll('.media-card'))el.setAttribute('aria-pressed',String(el.dataset.id===row.id));player(row);updateImport();if(matchMedia("(max-width:760px)").matches)$(".media-inspector").scrollIntoView({behavior:"smooth",block:"start"});
 }
 async function connect(){
  $('#media-connect').disabled=true;$('#media-connection').textContent='正在连接达芬奇…';
  try{const data=await api('resolve');connection=data;if(!data.ok)throw Error(data.error);$('#media-connection').textContent=data.timeline?`${data.project} / ${data.timeline} · ${data.fps} fps · 播放头 ${data.playhead}`:'已连接，请在达芬奇打开一条时间线';
   for(const kind of ['video','audio']){const el=$('#media-'+kind+'-track'),old=el.value;el.replaceChildren(...(data.tracks[kind]||[]).map(t=>{const option=new Option(`${kind==='video'?'V':'A'}${t.index} · ${t.name}${t.locked?'（锁定）':''}`,t.index);option.disabled=t.locked;return option;}));if([...el.options].some(o=>o.value===old&&!o.disabled))el.value=old;}
  }catch(e){connection=null;$('#media-connection').textContent=e.message;}finally{$('#media-connect').disabled=false;updateImport();}
 }
 async function insert(){
  if(importing||!selected||!connection?.timelineId)return;
  importing=true;updateImport();message('正在导入 '+(selected.displayName||selected.name)+'…');
  const request={requestId:crypto.randomUUID(),id:selected.id,projectId:connection.projectId,timelineId:connection.timelineId,position:$('#media-position').value,videoTrack:Number($('#media-video-track').value)||1,audioTrack:Number($('#media-audio-track').value)||1,videoMode:$('#media-video-mode').value};
  try{const result=await api('import',request);if(!result.ok)throw Error(result.error);message(result.message+' · '+result.items.map(i=>`${i.track?.[0]==='audio'?'A':'V'}${i.track?.[1]} · 帧 ${i.start}–${i.end}`).join('；')+'。'+(result.warning||'')+'请在达芬奇保存工程。');}
  catch(e){message(e.message);}finally{importing=false;updateImport();await connect();try{status(await api('status'));}catch{}}
 }
 async function load(){if(loading)return;loading=true;try{
  const data=await api('status');status(data);if(!started&&data.total===0&&data.roots.length){await api('scan',{});}started=true;await search(false);void connect();
 }catch(e){message(e.message);}finally{loading=false;}}
 $('#media-query').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>search(),220);};$('#media-kind').onchange=()=>search();$('#media-all-folders').onclick=()=>chooseFolder();$('#media-hover-sound').onchange=()=>{if(hoverMedia){hoverMedia.muted=!$('#media-hover-sound').checked;if(!hoverMedia.muted)hoverMedia.play().catch(()=>{});}};
 $('#media-prev').onclick=()=>{page--;search(false);};$('#media-next').onclick=()=>{page++;search(false);};
 $('#media-scan').onclick=async()=>{try{status(await api('scan',{}));message('正在扫描素材文件夹。');await search(false);}catch(e){message(e.message);}};
 if(window.mambaDesktop){$('#media-roots-pick').hidden=false;$('#media-roots-pick').onclick=async()=>{try{const paths=await window.mambaDesktop.chooseFolders();const old=$('#media-roots-input').value.split('\n').filter(Boolean);$('#media-roots-input').value=[...new Set([...old,...paths])].join('\n');}catch(e){message(e.message);}};}
 $('#media-roots-save').onclick=async()=>{try{status(await api('roots',{roots:$('#media-roots-input').value.split('\n').map(s=>s.trim()).filter(Boolean)}));message('目录已保存，正在建立索引。');await search();}catch(e){message(e.message);}};
 $('#media-connect').onclick=connect;$('#media-compatible').onclick=()=>selected&&player(selected,true);$('#media-large').onclick=()=>{if(selected)largePlayer(selected);};$('#media-original').onclick=()=>selected&&player(selected);$('#media-video-mode').onchange=updateImport;$('#media-import').onclick=insert;
 $('#media-unlock').onclick=()=>$('#media-unlock-dialog').showModal();$('#media-unlock-cancel').onclick=()=>$('#media-unlock-dialog').close();$('#media-unlock-confirm').onclick=async()=>{try{status(await api('unlock',{}));$('#media-unlock-dialog').close();message('已解除导入锁定，请核对素材是否已存在后再操作。');}catch(e){message(e.message);}};
 window.addEventListener('hashchange',()=>{if(location.hash!=='#media'){stopHover();waveformObserver?.disconnect();waveformQueue=[];clearTimeout(scanTimer);++thumbEpoch;$('#media-player').querySelectorAll('video,audio').forEach(p=>p.pause());}});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stopHover();});window.addEventListener('blur',stopHover);
 window.MAMBA_MEDIA={load};
})();
