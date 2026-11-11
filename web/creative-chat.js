'use strict';

function creativeChatPanel(project,options={}) {
  const material=options.mode==='materials',apiRoot=material?'/api/materials/chat':'/api/creative';
  const panel=el('section','creative-chat');panel.setAttribute('aria-label',material?'分镜智能体对话':'创意文案对话');
  const top=el('div','creative-top'),intro=el('div');intro.append(el('small','action-label','CREATIVE PARTNER'),el('h2','',material?'一起把文案变成镜头':'先聊清楚，再写出好文案'));
  const controls=el('div','creative-controls'),select=el('select');select.setAttribute('aria-label','文案智能体');
  controls.append(select,button('＋ 添加智能体',()=>configureCreativeAgent(refreshAgents,{apiRoot})));
  top.append(intro,controls);
  const progress=el('ol','creative-progress');
  for(const label of (material?['镜头叙事','视觉风格','画幅与节奏','镜头表']:['明确目标','创意方向','表达结构','完整文案']))progress.append(el('li','',label));
  const log=el('div','creative-log');log.setAttribute('role','log');log.setAttribute('aria-label','文案对话记录');log.setAttribute('aria-live','polite');
  const status=el('p','creative-status');status.setAttribute('role','status');
  const choices=el('div','creative-choices');choices.setAttribute('aria-label','本轮方向选择');
  const form=el('form','creative-composer'),input=el('textarea');input.rows=3;input.maxLength=6000;input.setAttribute('aria-label','创作需求或补充');input.placeholder='先说说这次想做什么：产品、受众、投放场景，或你脑中的一个想法…';
  const toolbar=el('div','creative-send'),hint=el('small','','每轮先提问，至少三个方向，由你决定下一步。'),actions=el('div');
  const send=el('button','primary','开始对话');send.type='submit';
  const refine=button('补充后重新提问',()=>submit('refine'));
  actions.append(refine,send);toolbar.append(hint,actions);form.append(input,toolbar);
  const footer=el('div','creative-footer');
  const context=el('details','creative-context');context.append(el('summary','','将发送给智能体的项目背景'),el('p','stage-text',project.name+'\n'+(project.notes||'暂无简报；可在对话中补充。')));
  panel.append(top,progress,log,status,choices,form,footer,context);
  let state,agents=[],chosen='',busy=false,pollTimer,lastRevision=-1;
  const drafts=window.MambaCreativeInputs ||= new Map();input.value=drafts.get(apiRoot+project.id)||'';input.oninput=()=>drafts.set(apiRoot+project.id,input.value);
  const base=apiRoot+'/projects/'+encodeURIComponent(project.id);
  async function api(url,body){const r=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const value=await r.json();if(!r.ok)throw Error(value.error||'无法连接创意智能体。');return value;}
  function schedule(){clearTimeout(pollTimer);if(state?.status==='running')pollTimer=setTimeout(()=>{if(panel.isConnected)void refresh();},1400);}
  async function refreshAgents(){agents=await api(apiRoot+'/agents');select.replaceChildren(...agents.map(a=>new Option(a.name+(a.available===false?' · 未安装':''),a.id)));select.value=state?.agentId||'codex-local';}
  async function refresh(){
    try{const next=await api(base);state=next;if(state.revision!==lastRevision||state.status==='failed'){chosen='';draw();lastRevision=state.revision;}schedule();}
    catch(e){status.textContent=e.message;const retry=button('重新连接',()=>refresh());status.append(' ',retry);}
  }
  function draw(){
    const sourceChanged=material&&state.context&&(state.context.sourceDraft?.id!==project.sourceId||state.context.notes!==project.notes);
    select.value=state.agentId;select.disabled=busy||state.status==='running';
    const current=Math.min(state.phase,3);Array.from(progress.children).forEach((li,i)=>{li.classList.toggle('done',i<current);if(i===current)li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');});
    const nearBottom=log.scrollHeight-log.scrollTop-log.clientHeight<90;
    log.replaceChildren();
    if(!state.messages.length){const empty=el('div','creative-empty');empty.append(el('span','creative-avatar','黑'),el('h3','',material?'先确定镜头怎么讲故事':'你的创意，从一个问题开始'),el('p','',material?'我会结合选定文案，先提出镜头叙事、视觉风格和画幅节奏的问题，确认后整理镜头表。':'告诉我你的需求。我会结合项目背景，提出不同方向的问题供你选择，逐步把文案打磨完整。'));log.append(empty);}
    for(const msg of state.messages){
      const bubble=el('article','creative-message '+(msg.role==='user'?'from-user':'from-agent'));
      bubble.append(el('small','',msg.role==='user'?'你':msg.agent||'文案智能体'));
      if(msg.role==='user')bubble.append(el('p','',msg.text));
      else {
        if(msg.summary)bubble.append(el('p','',msg.summary));
        if(msg.question)bubble.append(el('h3','',msg.question));
        if(msg.type==='question'&&msg.id!==state.pending?.id){const details=el('details');details.append(el('summary','','查看当时的 '+msg.options.length+' 个方向'));for(const o of msg.options)details.append(el('p','',o.label+' · '+o.question+'\n'+o.reason));bubble.append(details);}
        if(msg.draft)bubble.append(el('p','creative-draft',material?'镜头表已整理，共 '+(msg.plan?.shots?.length||0)+' 镜。来源：'+(msg.sourceDraft?.title||'待核实')+'。请在下方核对后生成图片。':msg.draft));
      }log.append(bubble);
    }
    choices.replaceChildren();
    if(state.status==='question'&&!sourceChanged){
      const grid=el('div','creative-choice-grid');grid.setAttribute('role','group');grid.setAttribute('aria-label','选择一个创意方向');
      for(const option of state.pending.options){const choice=button('',()=>{chosen=option.id;for(const c of grid.children)c.setAttribute('aria-pressed',String(c===choice));send.textContent='确认方向，继续 →';});choice.className='creative-choice';choice.setAttribute('aria-pressed','false');choice.append(el('span','choice-label',option.id.padStart(2,'0')+' / '+option.label),el('strong','',option.question),el('small','',option.reason));grid.append(choice);}
      choices.append(grid);
    }
    status.textContent=state.status==='running'?'智能体正在根据你的选择推敲下一步… 可离开页面，回来继续。':state.status==='ready'?'关键选择已确认。你可以继续补充，或生成完整文案。':state.status==='failed'?state.error:'';
    if(state.status==='failed')status.append(' ',button('重试本轮',()=>submit('retry')));
    input.disabled=busy||state.status==='running'||state.status==='failed';send.disabled=input.disabled;
    refine.hidden=!['question','ready'].includes(state.status);refine.disabled=input.disabled;
    send.textContent=state.status==='idle'?'开始对话':state.status==='ready'?'生成完整文案':state.status==='draft'?'提出修改方向':'确认方向，继续 →';
    input.placeholder=state.status==='idle'?'先说说这次想做什么：产品、受众、投放场景，或你脑中的一个想法…':state.status==='question'?'选一个方向，可补充细节；也可以直接输入你自己的方向。':'补充新的要求或写下修改意见…';
    footer.replaceChildren();
    if(state.messages.length)footer.append(button('导出对话',()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=el('a');link.href=url;link.download='创意对话-'+project.name.replace(/[\\/:*?"<>|]/g,'-')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}));
    if(state.draft&&material&&state.status==='draft'&&!sourceChanged){options.renderPlan?.(footer,state.draft);}
    if(state.draft&&!material){
      addCopyAction(footer,'复制最新文案',state.draft.draft);
      const saved=savedCopyDrafts(items.find(p=>p.id===project.id)||project).find(row=>row.id==='creative-'+state.draft.id);
      const save=button(saved?'已保存第 '+saved.draftNumber+' 稿':'保存文案到方案记录',()=>{
        try {
          // Read the latest project list before assigning a number (other windows may have saved).
          const raw=localStorage.getItem(KEY),latest=raw?JSON.parse(raw):items;
          if(!Array.isArray(latest)||!latest.every(validate))throw Error('项目记录无法读取，请刷新后再保存。');
          const current=latest.find(p=>p.id===project.id);if(!current)throw Error('项目已不存在。');
          const result=appendCopyDraft(current,state.draft);
          if(!result.created){toast(result.row.title+'已保存。');return;}
          if(persist(latest.map(p=>normalize(p.id===project.id?result.project:p))))toast(result.row.title+'已保存，可在项目树中查看。');
        }catch(error){toast(error.message||'文案保存失败');}
      },'primary');save.disabled=Boolean(saved);footer.append(save);
      footer.append(button('查看项目树',()=>openProjectWorkflow(project.id)));
    }
    if(material){if(state.status==='ready'){send.textContent='整理镜头表';status.textContent='方向已确认，可先整理镜头表，尚不会生成图片。';}else if(state.status==='draft')send.textContent='讨论镜头修改';input.placeholder='描述镜头拆分、风格、人物或产品一致性要求；更换文案后，请在这里提出重新讨论。';}
    if(sourceChanged){status.textContent='已接收的文案与这段分镜对话不同。旧镜头表保留原来源，请重新讨论后再出图。';send.disabled=true;refine.hidden=true;const restart=button('按已接收文案重新讨论',()=>submit('rebase'),'primary');restart.disabled=busy||state.status==='running';footer.append(restart);}
    if(nearBottom||state.status==='question'||state.status==='draft')requestAnimationFrame(()=>{log.scrollTop=log.scrollHeight;});
  }
  async function submit(action){
    if(busy||!state)return;
    const message=input.value.trim();
    if(action==='answer'&&!chosen&&!message)return toast('请选择一个方向，或输入你自己的方向。');
    if(['start','refine'].includes(action)&&!message)return toast('请先输入需求或补充。');
    // A typed supplement must be discussed before final generation, never silently dropped.
    if(action==='draft'&&message)action='refine';
    busy=true;const agentId=select.value;draw();
    try{
      state=await api(base+'/turn',{action,message,agentId,revision:state.revision,requestId:crypto.randomUUID(),questionId:state.pending?.id,optionId:chosen,context:{name:project.name,notes:project.notes||'',sourceId:project.sourceId,sourceTitle:project.sourceTitle}});
      input.value='';drafts.delete(apiRoot+project.id);chosen='';lastRevision=state.revision;
    }catch(e){toast(e.message);state=await api(base).catch(()=>state);}
    finally{busy=false;draw();schedule();}
  }
  form.onsubmit=e=>{e.preventDefault();submit(state?.status==='idle'?'start':state?.status==='ready'?'draft':state?.status==='draft'?'refine':'answer');};
  input.onkeydown=e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)&&!e.isComposing){e.preventDefault();form.requestSubmit();}};
  status.textContent='正在读取对话…';send.disabled=true;refine.hidden=true;
  void Promise.all([refreshAgents(),refresh()]).catch(e=>{status.textContent=e.message;status.append(' ',button('重新连接',()=>{void refreshAgents().then(refresh).catch(e=>toast(e.message));}));});
  return panel;
}

function configureCreativeAgent(onSaved,{apiRoot='/api/creative',image=false}={}) {
  const dialog=el('dialog','creative-agent-dialog'),form=el('form');dialog.setAttribute('aria-label',image?'添加 MCP 出图服务':'添加 MCP 智能体');
  const title=el('h2','',image?'添加 MCP 出图服务':'添加 MCP 智能体');
  form.append(title,el('p','',image?'选择同步返回一张 MCP image 图片的工具。只返回任务编号或图片链接的服务需要专用适配；此入口不会自动轮询或下载外部链接。':'连接提供对话工具的 MCP 服务。发送消息时，会把当前项目背景和对话交给你选定的服务。'));
  const fields={};
  function field(key,label,placeholder,kind='input'){const wrap=el('label','',label),input=el(kind);input.name=key;input.placeholder=placeholder;fields[key]=input;wrap.append(input);form.append(wrap);return input;}
  field('name',image?'出图服务名称':'智能体名称',image?'例如：分镜出图服务':'例如：品牌文案顾问').required=true;
  field('url','MCP 地址','https://example.com/mcp').required=true;
  const optional=el('details');optional.append(el('summary','','认证与附加参数（可选）'));form.append(optional);
  const token=field('tokenEnv','认证环境变量名称','MAMBA_MCP_TOKEN');optional.append(token.parentElement);
  const args=field('arguments','附加工具参数（JSON）','{}','textarea');args.value='{}';optional.append(args.parentElement);
  const probe=button('读取可用工具',async()=>{
    probe.disabled=true;save.disabled=true;status.textContent='正在连接 MCP…';
    try{
      const result=await call(apiRoot+'/probe',{url:fields.url.value,tokenEnv:fields.tokenEnv.value});
      tools=result.tools;tool.replaceChildren(...tools.map(t=>new Option(t.name,t.name)));updateFields();
      status.textContent=tools.length?(image?'已连接，请选择出图工具和提示词字段。':'已连接，请选择负责对话的工具和输入字段。'):'服务没有提供工具。';save.disabled=!tools.length;
    }catch(e){status.textContent=e.message;}finally{probe.disabled=false;}
  });form.append(probe);
  const tool=field('tool',image?'出图工具':'对话工具','','select'),inputKey=field('inputKey','提示词输入字段','','select');let tools=[];
  function updateFields(){const current=tools.find(t=>t.name===tool.value);inputKey.replaceChildren(...Object.entries(current?.inputSchema?.properties||{}).filter(([,v])=>v.type==='string').map(([key])=>new Option(key,key)));if(Array.from(inputKey.options).some(o=>o.value==='prompt'))inputKey.value='prompt';}
  tool.onchange=updateFields;
  const status=el('p','creative-status');status.setAttribute('role','status');form.append(status);
  const controls=el('div','modal-actions'),save=el('button','primary',image?'添加出图服务':'添加智能体');save.type='submit';save.disabled=true;
  controls.append(button('取消',()=>dialog.close()),save);form.append(controls);dialog.append(form);document.body.append(dialog);dialog.onclose=()=>dialog.remove();dialog.showModal();fields.name.focus();
  async function call(url,data){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const value=await r.json();if(!r.ok)throw Error(value.error||'无法连接 MCP。');return value;}
  form.onsubmit=async e=>{
    e.preventDefault();save.disabled=true;
    try{let args;try{args=JSON.parse(fields.arguments.value||'{}');}catch{throw Error('附加参数需要有效的 JSON。');}
      await call(apiRoot+'/agents',{name:fields.name.value,url:fields.url.value,tokenEnv:fields.tokenEnv.value,tool:tool.value,inputKey:inputKey.value,arguments:args});await onSaved();dialog.close();toast('智能体已添加，可在对话中选择。');
    }catch(e){status.textContent=e.message;}finally{save.disabled=false;}
  };
}
