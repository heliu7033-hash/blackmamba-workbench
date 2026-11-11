'use strict';
const shotMotions={still:'固定',push:'推近',pull:'拉远',left:'左移',right:'右移'};
const storyboardURL=(project,id='',action='')=>'/api/storyboards/'+[project,id,action].filter(Boolean).map(encodeURIComponent).join('/');
async function boardAPI(project,id,action,value){
  const res=await fetch(storyboardURL(project,id,action),value?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}:{});
  const result=await res.json();if(!res.ok)throw Error(result.error || '本机工作台服务暂不可用');return result;
}
function projectProposal(project){
  const entry=stageRows(project).filter(r=>r.stage==='creative').at(-1);
  if(entry)return [entry.title,entry.note].filter(Boolean).join('\n').slice(0,6000);
  const notes=splitBrief(project.notes),creative=notes.filter(s=>/故事|台词|脚本|创意|导演|当前提案/.test(s.title) && !/归档|索引/.test(s.title));
  return (creative.length?creative.map(s=>s.title+'\n'+s.text).join('\n\n'):notes.filter(s=>!/归档|索引|存储|文件位置/.test(s.title)).map(s=>s.text).join('\n')).slice(0,6000);
}
function beginStoryboard(project,refresh,previous){
  const dialog=$('#storyboard-dialog'),form=el('form'),planLabel=el('label','','发送给 Codex 的方案摘录'),plan=el('textarea');
  plan.rows=8;plan.maxLength=6000;plan.required=true;plan.value=previous?.proposal || projectProposal(project);planLabel.append(plan);
  const countLabel=el('label','','镜头数'),count=el('input');count.type='number';count.min=2;count.max=8;count.value=previous?.count||3;count.required=true;countLabel.append(count);
  const state=el('p','study-note','使用本机登录的 Codex 在线生成。只发送以上文字和本版的参考静帧，生成结果保存在本机。'),actions=el('div','modal-actions'),submit=el('button','primary','开始生成分镜图');submit.type='submit';
  actions.append(button('取消',()=>dialog.close()),submit);form.append(el('h2','','生成分镜图'),el('p','',project.name),planLabel,countLabel,state,actions);const id=crypto.randomUUID();
  form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;try{await boardAPI(project.id,id,'generate',{proposal:plan.value,count:Number(count.value),consent:true});dialog.close();await refresh();}catch(err){state.textContent=err.message;submit.disabled=false;}};
  dialog.replaceChildren(form);dialog.showModal();plan.focus();
}
function storyboardPanel(project){
  const box=stageBlock('项目分镜'),bar=el('div','detail-shortcuts'),versions=el('div','board-versions');
  const create=button('▧ 生成分镜图',()=>beginStoryboard(project,refresh),'primary');bar.append(create);box.append(bar,versions);
  let request=0,timer;
  function shotNode(v,s){
    const fig=el('figure','board-shot'),img=el('img');img.src=storyboardURL(project.id,v.id,s.file);img.alt='镜头 '+s.number+' · '+s.action;
    const info=el('figcaption'),name=el('strong','','镜头 '+String(s.number).padStart(2,'0'));info.append(name);
    if(v.status==='draft'){
      const a=el('label','','动作说明'),input=el('textarea');input.name='action';input.rows=2;input.maxLength=650;input.value=s.action;a.append(input);
      const d=el('label','','时长（秒）'),seconds=el('input');seconds.type='number';seconds.name='seconds';seconds.step='.5';seconds.min='.5';seconds.max='30';seconds.value=s.seconds;d.append(seconds);
      const m=el('label','','运镜'),sel=el('select');sel.name='motion';for(const [k,v] of Object.entries(shotMotions))sel.add(new Option(v,k));sel.value=s.motion;m.append(sel);info.append(a,d,m);
    }else info.append(el('p','',s.action),el('small','',s.seconds+' 秒 · '+shotMotions[s.motion]+' · 硬切'));
    fig.append(img,info);return fig;
  }
  function version(v,index,total){
    const card=el('section','story-version'),header=el('div','home-label'),state=el('p','study-note',v.message);card.dataset.version=v.id;
    const label='V'+(total-index)+' · '+({generating:'生成中',draft:'待确认',confirmed:'已确认',rendering:'渲染中',ready:'可播放',failed:'未完成'}[v.status]||'分镜');
    header.append(el('h3','',label),el('small','',new Date(v.createdAt).toLocaleString('zh-CN')));card.append(header,state);
    const source=el('details');source.append(el('summary','','此版方案摘录'),el('p','stage-text',v.proposal));card.append(source);
    if(v.shots.length){const grid=el('div','board-shots');grid.append(...v.shots.map(s=>shotNode(v,s)));card.append(grid);}
    const controls=el('div','detail-shortcuts');
    function operation(text,action,value){
      const b=button(text,async()=>{b.disabled=true;try{await boardAPI(project.id,v.id,action,value());await refresh();}catch(e){state.textContent=e.message;b.disabled=false;}},'primary');controls.append(b);
    }
    if(v.status==='draft')operation('确认此版本','confirm',()=>({shots:[...card.querySelectorAll('.board-shot')].map((f,i)=>({number:i+1,action:f.querySelector('[name=action]').value,seconds:Number(f.querySelector('[name=seconds]').value),motion:f.querySelector('[name=motion]').value}))}));
    if(v.status==='confirmed')operation('▶ 生成动态分镜','render',()=>({}));
    if(['draft','failed','confirmed','ready'].includes(v.status))controls.append(button('调整画面并生成新版',()=>beginStoryboard(project,refresh,v)));
    if(v.video){const video=el('video');video.controls=true;video.playsInline=true;video.preload='metadata';video.src=storyboardURL(project.id,v.id,v.video.file);video.poster=storyboardURL(project.id,v.id,v.shots[0].file);card.append(video,el('small','','本版本静帧 · '+v.video.frames/v.video.fps+' 秒 · '+v.video.fps+' fps'));}
    card.append(controls);return card;
  }
  async function refresh(){
    clearTimeout(timer);const n=++request;
    try{const data=await boardAPI(project.id);if(n!==request || !box.isConnected)return;
      create.disabled=data.some(v=>['generating','rendering'].includes(v.status));versions.replaceChildren();
      if(!data.length){versions.append(el('p','study-note','本项目还没有分镜版本。'));return;}
      data.forEach((v,i)=>versions.append(version(v,i,data.length)));
      if(create.disabled)timer=setTimeout(()=>{if(box.isConnected)refresh();},2200);
    }catch(e){if(box.isConnected && n===request){versions.textContent=e.message;timer=setTimeout(()=>{if(box.isConnected)refresh();},3500);}}
  }
  queueMicrotask(refresh);return box;
}
