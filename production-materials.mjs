import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createCreativeChat,rules} from './creative-chat.mjs';
import {codexBinary,endpointURL,withMcp,listMcpTools,checkTool} from './creative-providers.mjs';
import {generateFrame} from './skills/studio-storyboards/scripts/engine.mjs';

const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const categories=['分镜图','实拍素材','参考素材','声音','其他'];
const statuses=['待复核','已确认','需修改'];
const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const text=(s,max)=>typeof s==='string'&&s.trim().length>0&&s.length<=max;
export function validateShotPlan(value){
  const p=typeof value==='string'?JSON.parse(value):value;
  if(!p||!text(p.style,1500)||!['16:9','9:16','1:1','4:3'].includes(p.ratio)||!Array.isArray(p.shots)||p.shots.length<1||p.shots.length>8)throw Error('镜头表需包含统一风格、画幅和 1–8 个镜头。');
  const shots=p.shots.map((s,i)=>{if(!text(s.action,650)||!text(s.prompt,2000)||!Number.isFinite(s.seconds)||s.seconds<.5||s.seconds>30||!['still','push','pull','left','right'].includes(s.motion))throw Error('每镜需有画面、提示词、时长与运镜。');return {number:i+1,action:s.action.trim(),prompt:s.prompt.trim(),seconds:Math.round(s.seconds*2)/2,motion:s.motion};});
  return {style:p.style.trim(),ratio:p.ratio,shots};
}
export const storyboardRules=rules.replaceAll('创意文案','分镜策划').replaceAll('完整文案','镜头表')+`
你负责将已选文案转成分镜。三轮分别确认叙事拆分、视觉风格与角色连续性、画幅与镜头节奏。已知的文案信息不要重复问。
仅在 draft 任务时，draft 字符串必须是可 JSON.parse 的镜头表 JSON，形如 {"style":"统一角色、物体、场景和美术描述","ratio":"16:9","shots":[{"action":"中文镜头动作","prompt":"完整单帧画面提示词","seconds":3,"motion":"still"}]}。
shots 为 1–8 镜，依据已确认决定；ratio 只能是 16:9、9:16、1:1、4:3；motion 只能是 still、push、pull、left、right。秒数 .5–30。每镜画面必须独立可画，同时保持角色产品一致；不添加没有依据的品牌或功效。此阶段只做镜头规划，禁止生成图片。`;
async function read(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
async function write(file,value){await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(value),{mode:0o600});await fs.rename(temp,file);}
async function jsonBody(req){if(!/^application\/json\b/.test(req.headers['content-type']||''))fail(415,'需要 JSON');let bytes=0,chunks=[];for await(const c of req){bytes+=c.length;if(bytes>300000)fail(413,'请求过大');chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks));}catch{fail(400,'JSON 无效');}}
function reply(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
export function imageType(b){if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return ['png','image/png'];if(b[0]===255&&b[1]===216&&b[2]===255)return ['jpg','image/jpeg'];if(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')return ['webp','image/webp'];if(/^GIF8[79]a/.test(b.toString('ascii',0,6)))return ['gif','image/gif'];return null;}
function mediaType(name,head){const image=imageType(head);if(image)return {kind:'image',ext:image[0],mime:image[1]};
  const ext=path.extname(name).toLowerCase().slice(1),allowed={mp4:['video','video/mp4'],mov:['video','video/quicktime'],webm:['video','video/webm'],mkv:['video','video/x-matroska'],mp3:['audio','audio/mpeg'],wav:['audio','audio/wav'],m4a:['audio','audio/mp4'],aac:['audio','audio/aac'],ogg:['audio','audio/ogg'],flac:['audio','audio/flac']};
  if(!allowed[ext])fail(400,'支持 PNG/JPEG/WebP/GIF 图片和常见视频、音频文件。');
  const ascii=head.toString('ascii'),iso=head.toString('ascii',4,8)==='ftyp',ebml=head.subarray(0,4).equals(Buffer.from([26,69,223,163]));
  const valid=['mp4','mov','m4a'].includes(ext)?iso:['webm','mkv'].includes(ext)?ebml:ext==='wav'?ascii.startsWith('RIFF')&&ascii.slice(8,12)==='WAVE':ext==='ogg'?ascii.startsWith('OggS'):ext==='flac'?ascii.startsWith('fLaC'):ascii.startsWith('ID3')||(head[0]===255&&(head[1]&224)===224);
  if(!valid)fail(400,'文件内容与媒体类型不匹配。');return {kind:allowed[ext][0],mime:allowed[ext][1],ext};
}
export async function mcpImage(agent,prompt){
  return withMcp(agent,async rpc=>{
    checkTool((await listMcpTools(rpc)).find(t=>t.name===agent.tool),agent);
    const result=await rpc('tools/call',{name:agent.tool,arguments:{...agent.arguments,[agent.inputKey]:prompt}});
    if(result.isError)throw Error('MCP 出图服务返回失败。');
    // Accept native MCP images. Remote links require a service adapter; never fetch arbitrary returned URLs.
    const images=(result.content||[]).filter(c=>c.type==='image');
    if(images.length!==1||!text(images[0].data,28000000)||!['image/png','image/jpeg','image/webp'].includes(images[0].mimeType))throw Error('此接入需要工具同步返回一张 MCP image 图片；任务编号或图片链接需要服务端适配。');
    if(!/^[A-Za-z0-9+/]+={0,2}$/.test(images[0].data))throw Error('MCP 图片编码无效。');
    const bytes=Buffer.from(images[0].data,'base64'),type=imageType(bytes);if(!type||bytes.length>20*1024*1024)throw Error('MCP 图片无效或超过 20 MB。');return {bytes,ext:type[0],mime:type[1]};
  },{maxBytes:30000000,timeoutMs:480000});
}
export function createProductionMaterials(data,{frame=generateFrame,imageProvider=mcpImage,chatProvider}={}){
  const root=path.join(data,'project-materials'),config=path.join(root,'image-agents.json'),locks=new Set(),active=new Set();
  const planner=createCreativeChat(data,{namespace:'material-chat',outputName:'镜头表',instructions:storyboardRules,steps:['镜头叙事','视觉风格','画幅与节奏'],validateDraft:validateShotPlan,contextLimit:22000,contextMapper:c=>{if(!text(c?.name,100)||!text(c?.notes,22000)||!text(c?.sourceId,180)||!text(c?.sourceTitle,200))fail(400,'请选择有效的文案来源');return {name:c.name,notes:c.notes,sourceDraft:{id:c.sourceId,title:c.sourceTitle,sha256:sha(c.notes)}};},...(chatProvider?{provider:chatProvider}:{})});
  const dirFor=id=>path.join(root,sha(id));
  async function load(id){const d=await read(path.join(dirFor(id),'index.json'),{revision:0,assets:[],jobs:[]});for(const j of d.jobs)if(j.status==='running'&&!active.has(j.id)){j.status='interrupted';j.message='上次生成中断。已完成图片保留，核对服务结果后可继续未完成镜头。';}return d;}
  async function mutate(id,fn){const dir=dirFor(id);if(locks.has(id))fail(409,'当前项目正在保存，请稍后重试。');locks.add(id);try{const d=await load(id),result=await fn(d);d.revision++;await write(path.join(dir,'index.json'),d);return result;}finally{locks.delete(id);}}
  async function agents(){return [{id:'codex-local',name:'本机 Codex',kind:'codex',available:!!codexBinary()},...await read(config,[])];}
  async function updateJob(project,id,fn){
    // Internal completion waits for a short import/metadata transaction without racing its manifest.
    while(locks.has(project))await new Promise(r=>setTimeout(r,20));
    return mutate(project,d=>fn(d.jobs.find(j=>j.id===id),d));
  }
  async function run(project,job,agent){
    const dir=path.join(dirFor(project),'files');await fs.mkdir(dir,{recursive:true});
    try{
      let current=(await load(project)).jobs.find(j=>j.id===job.id);
      let reference=current.assetIds.length?(await load(project)).assets.find(a=>a.id===current.assetIds[0])?.file:null;
      for(const shot of job.plan.shots){
        const d=await load(project);if(d.assets.some(a=>a.jobId===job.id&&a.shot===shot.number))continue;
        await updateJob(project,job.id,j=>{j.message='正在生成镜头 '+shot.number+' / '+job.plan.shots.length;});
        const id=randomUUID();let file,mime;
        if(agent.kind==='codex'){
          const scratch=path.join(dir,job.id);await fs.mkdir(scratch,{recursive:true});
          const result=await frame({prompt:shot.prompt,style:job.plan.style,ratio:job.plan.ratio,reference:reference?path.join(dir,reference):undefined,dir:scratch,number:shot.number});
          mime=result.mime;file=id+'.'+({'image/png':'png','image/webp':'webp'}[mime]||'jpg');await fs.copyFile(path.join(scratch,result.file),path.join(dir,file));
        }else{
          const result=await imageProvider(agent,'生成一张 '+job.plan.ratio+' 单帧分镜图。不要拼图或文字。统一外观：'+job.plan.style+'\n镜头 '+shot.number+'：'+shot.prompt);
          file=id+'.'+result.ext;mime=result.mime;await fs.writeFile(path.join(dir,file),result.bytes,{mode:0o600});
        }
        const bytes=await fs.readFile(path.join(dir,file));if(!imageType(bytes))throw Error('出图结果不是有效图片。');
        const asset={id,file,mime,kind:'image',category:'分镜图',source:'generated',name:'分镜 '+shot.number+' · '+shot.action,shot:shot.number,status:'待复核',createdAt:Date.now(),size:bytes.length,sha256:sha(bytes),jobId:job.id,provider:agent.name,sourceDraft:job.sourceDraft,action:shot.action,prompt:shot.prompt};
        await updateJob(project,job.id,(j,d)=>{d.assets.push(asset);j.assetIds.push(id);});if(!reference)reference=file;
      }
      await updateJob(project,job.id,j=>{j.status='complete';j.message='图片已生成，请核对画面后标记状态。';});
    }catch(e){await updateJob(project,job.id,j=>{j.status=j.assetIds.length?'partial':'failed';j.message=String(e.message||'生成失败').replace(/(?:\/Users\/|\/private\/)[^\s]*/g,'本机路径').slice(0,350);});}
    finally{active.delete(job.id);}
  }
  async function serve(req,res,project,id){const a=(await load(project)).assets.find(a=>a.id===id);if(!a)fail(404,'素材不存在');const file=path.join(dirFor(project),'files',a.file),stat=await fs.stat(file);let start=0,end=stat.size-1,status=200;
    const h={'Content-Type':a.mime,'X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes','Cache-Control':'private, max-age=86400'};
    if(req.headers.range){const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!m||(!m[1]&&!m[2]))fail(416,'范围无效');if(m[1]){start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]));}else start=Math.max(0,stat.size-Number(m[2]));if(start>end||start>=stat.size){res.writeHead(416,{'Content-Range':'bytes */'+stat.size});res.end();return;}status=206;h['Content-Range']=`bytes ${start}-${end}/${stat.size}`;}
    h['Content-Length']=end-start+1;res.writeHead(status,h);const stream=createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
  }
  async function upload(req,project,id){
    if(!uuid.test(id))fail(400,'导入编号无效');
    const purpose=req.headers['x-purpose']||'';if(!['','resolve-export','ae-export'].includes(purpose))fail(400,'文件用途无效');
    const existing=(await load(project)).assets.find(a=>a.id===id);if(existing){if((existing.purpose||'')!==purpose)fail(409,'导入编号已用于另一类文件');req.resume();return existing;}
    let name;try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{fail(400,'文件名无效');}
    if(!text(name,255)||/[\\/\x00-\x1f]/.test(name))fail(400,'文件名无效');
    const category=decodeURIComponent(req.headers['x-category']||'其他');if(!categories.includes(category))fail(400,'分类无效');
    const dir=path.join(dirFor(project),'files');await fs.mkdir(dir,{recursive:true});const temp=path.join(dir,randomUUID()+'.upload');const handle=await fs.open(temp,'wx',0o600),hash=createHash('sha256');let size=0,head=Buffer.alloc(0);
    const limit=(purpose?20*1024:512)*1024*1024;
    try{for await(const part of req){size+=part.length;if(size>limit)fail(413,purpose?'单个后期导出文件最多 20 GB。':'单个素材最多 512 MB；更大文件请在素材库登记所在文件夹。');if(head.length<32)head=Buffer.concat([head,part]).subarray(0,32);hash.update(part);await handle.writeFile(part);}await handle.close();if(!size)fail(400,'文件为空');
      const type=mediaType(name,head);if(purpose&&type.kind!=='video')fail(400,'后期版本需要视频导出文件。');
      const digest=hash.digest('hex'),asset={id,name,...type,file:id+'.'+type.ext,source:'local',category,shot:0,status:'待复核',createdAt:Date.now(),size,sha256:digest,...(purpose?{purpose}:{})};
      return await mutate(project,async d=>{const duplicate=d.assets.find(a=>a.id===id||a.sha256===digest&&(a.purpose||'')===purpose);if(duplicate)return duplicate;await fs.rename(temp,path.join(dir,asset.file));d.assets.push(asset);return asset;});
    }finally{await handle.close().catch(()=>{});await fs.rm(temp,{force:true});}
  }
  async function request(req,res,url,origin){
    try{
      if(req.method==='POST'&&req.headers.origin!==origin)fail(403,'仅允许本机工作台操作。');
      const route=url.pathname.slice('/api/materials/'.length);
      if(route.startsWith('chat/')){const u=new URL(url);u.pathname='/api/creative/'+route.slice(5);return planner.request(req,res,u,origin);}
      if(route==='agents'&&req.method==='GET')return reply(res,200,await agents());
      if(['agents','probe'].includes(route)&&req.method==='POST'){
        const v=await jsonBody(req),agent={id:randomUUID(),name:v.name,kind:'mcp',url:endpointURL(v.url),tool:v.tool,inputKey:v.inputKey,tokenEnv:v.tokenEnv||'',arguments:v.arguments||{}};
        if(agent.tokenEnv&&!/^MAMBA_MCP_[A-Z0-9_]{1,80}$/.test(agent.tokenEnv))fail(400,'认证使用 MAMBA_MCP_ 开头的环境变量名。');
        const tools=await withMcp(agent,listMcpTools);if(route==='probe')return reply(res,200,{tools:tools.map(t=>({name:t.name,inputSchema:t.inputSchema}))});
        if(!text(agent.name,60)||!agent.arguments||typeof agent.arguments!=='object'||Array.isArray(agent.arguments)||JSON.stringify(agent.arguments).length>6000)fail(400,'服务名称或附加参数无效');checkTool(tools.find(t=>t.name===agent.tool),agent);
        if(locks.has('config'))fail(409,'正在保存出图服务');locks.add('config');try{const all=await read(config,[]);if(all.length>=30)fail(400,'服务数量已达上限');await write(config,[...all,agent]);}finally{locks.delete('config');}return reply(res,201,agent);
      }
      const m=/^projects\/([^/]+)(?:\/(file|upload|generate|resume|asset)\/([^/]+))?$/.exec(route);if(!m)fail(404,'接口不存在');const project=decodeURIComponent(m[1]),action=m[2],id=m[3];if(!text(project,160))fail(400,'项目无效');if(id&&!uuid.test(id))fail(400,'编号无效');
      if(req.method==='GET'&&!action)return reply(res,200,await load(project));
      if(req.method==='GET'&&action==='file')return await serve(req,res,project,id);
      if(req.method!=='POST')fail(405,'不支持此操作');
      if(action==='upload')return reply(res,201,await upload(req,project,id));
      const input=await jsonBody(req);
      if(action==='asset'){const a=await mutate(project,d=>{if(d.revision!==input.revision)fail(409,'素材已更新，请刷新后再保存');const row=d.assets.find(a=>a.id===id);if(!row)fail(404,'素材不存在');if(!categories.includes(input.category)||!statuses.includes(input.status)||!Number.isInteger(input.shot)||input.shot<0||input.shot>999)fail(400,'分类、状态或镜号无效');Object.assign(row,{category:input.category,status:input.status,shot:input.shot});return row;});return reply(res,200,a);}
      if(!['generate','resume'].includes(action))fail(404,'未知操作');
      let job=(await load(project)).jobs.find(j=>j.id===id);
      if(action==='generate'&&job)return reply(res,200,job);
      if(active.size)fail(409,'当前正在生成图片，请等待完成');
      if(input.consent!==true)fail(400,'请先确认镜头表和出图服务');
      if(action==='generate'){
        const state=await planner.state(project);if(!state.draft?.plan||state.draft.id!==input.planId||state.status!=='draft')fail(409,'请先完成分镜对话并生成当前镜头表');
        let plan;try{plan=validateShotPlan(input.plan);}catch(e){fail(400,e.message);}
        if(!state.draft.sourceDraft)fail(409,'镜头表缺少文案来源，请重新讨论');
        job={id,status:'running',planId:input.planId,plan,sourceDraft:state.draft.sourceDraft,providerId:input.providerId||'codex-local',createdAt:Date.now(),assetIds:[],message:'准备生成分镜图'};
      }else{if(!job||!['failed','partial','interrupted'].includes(job.status))fail(409,'此批次不需要继续');job={...job,status:'running'};}
      const agent=(await agents()).find(a=>a.id===job.providerId);if(!agent)fail(400,'出图服务不存在');
      if(active.size)fail(409,'当前正在生成图片，请等待完成');
      active.add(id);try{await mutate(project,d=>{if(action==='generate'){if(d.jobs.length>=100)fail(400,'本项目批次已达上限');d.jobs.push(job);}else d.jobs[d.jobs.findIndex(j=>j.id===id)]=job;});}catch(e){active.delete(id);throw e;}
      void run(project,job,agent).catch(()=>active.delete(id));reply(res,202,job);
    }catch(e){if(res.headersSent){res.destroy();return;}reply(res,e.status||(e.code==='ENOENT'?404:500),{error:e.status?e.message:/MCP|工具|认证|图片/.test(e.message)?e.message:'无法完成素材操作，已有记录已保留。'});}
  }
  return {request,planner,load,agents};
}
