import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {generateDraft,renderAnimatic,movements} from './skills/studio-storyboards/scripts/engine.mjs';

const instance=randomUUID(),locks=new Set(),active=new Set();
const jobId=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
function fail(status,message){throw Object.assign(Error(message),{status});}
const read=async dir=>{
  const v=JSON.parse(await fs.readFile(path.join(dir,'version.json'),'utf8'));
  if(v.instance!==instance && ['generating','rendering'].includes(v.status)){
    v.status=v.confirmedAt?'confirmed':'failed';v.message='服务上次退出时任务中断，可重新发起。';
  }
  return v;
};
async function save(dir,value){
  const tmp=path.join(dir,'version-'+randomUUID()+'.tmp');await fs.writeFile(tmp,JSON.stringify(value));await fs.rename(tmp,path.join(dir,'version.json'));
}
async function body(req){
  if(!/^application\/json\b/.test(req.headers['content-type']||''))fail(415,'需要 JSON');
  let bytes=0,parts=[];for await(const c of req){bytes+=c.length;if(bytes>48000)fail(413,'方案过长');parts.push(c);}
  try{return JSON.parse(Buffer.concat(parts));}catch{fail(400,'输入不是 JSON');}
}
function reply(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
async function runJob(dir,v,type){
  try{
    if(type==='generate'){
      v.shots=await generateDraft({proposal:v.proposal,count:v.count,dir,onProgress:async note=>{v.message=note;await save(dir,v);}});v.status='draft';v.message='分镜图已生成，请逐镜核对后确认。';
    }else{
      v.video=await renderAnimatic(dir,v.shots);v.status='ready';v.message='动态分镜已生成。';
    }
  }catch(e){v.status=type==='generate'?'failed':'confirmed';v.message=String(e.message).replace(/(?:\/Users\/|\/private\/)[^\s]*/g,'本机路径').slice(0,350);}
  finally {try{await save(dir,v);}finally{active.delete(dir);}}
}
async function media(req,res,dir,file){
  if(!/^shot-\d{2}\.jpg$|^animatic\.mp4$/.test(file))fail(404,'文件不存在');
  const v=await read(dir);if(!v.shots?.some(s=>s.file===file) && v.video?.file!==file)fail(404,'文件未就绪');
  const full=path.join(dir,file),s=await fs.stat(full);let start=0,end=s.size-1,status=200;
  const headers={'Content-Type':file.endsWith('.mp4')?'video/mp4':'image/jpeg','Accept-Ranges':'bytes','Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff'};
  if(req.headers.range){
    const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
    if(!m || +m[1]>end || (m[2] && +m[2]<+m[1])){res.writeHead(416,{'Content-Range':'bytes */'+s.size});res.end();return;}
    start=+m[1];end=m[2]?Math.min(end,+m[2]):end;status=206;headers['Content-Range']='bytes '+start+'-'+end+'/'+s.size;
  }
  headers['Content-Length']=end-start+1;res.writeHead(status,headers);
  const stream=createReadStream(full,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
}
export async function storyboardRequest(req,res,url,data,origin){
  let lock, reservation;
  try{
    const parts=url.pathname.split('/').slice(3).map(decodeURIComponent);
    const [project,id,action]=parts;
    if(!project || project.length>160 || parts.length>3 || url.search)fail(400,'无效项目路径');
    const root=path.join(data,'storyboards',createHash('sha256').update(project).digest('hex'));
    if(req.method==='GET' && !id){
      const dirs=await fs.readdir(root).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
      const versions=await Promise.all(dirs.filter(n=>jobId.test(n)).map(n=>read(path.join(root,n)).catch(e=>{if(e.code==='ENOENT')return null;throw e;})));
      return reply(res,200,versions.filter(Boolean).sort((a,b)=>b.createdAt-a.createdAt));
    }
    if(!jobId.test(id||''))fail(404,'版本不存在');const dir=path.join(root,id);
    if(req.method==='GET' && action)return await media(req,res,dir,action);
    if(req.method!=='POST' || req.headers.origin!==origin)fail(403,'仅允许本机工作台操作');
    if(!['generate','confirm','render'].includes(action))fail(404,'未知操作');
    const inp=await body(req);
    if(locks.has(root))fail(409,'请等待当前操作完成');locks.add(root);lock=root;
    if(action==='generate'){
      if(inp.consent!==true || typeof inp.proposal!=='string'||!inp.proposal.trim()||inp.proposal.length>6000 || !Number.isInteger(inp.count)||inp.count<2||inp.count>8)fail(400,'请确认方案摘录和 2–8 个镜头');
      const prior=await read(dir).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(prior)return reply(res,200,prior);
      if(active.size)fail(409,'本机正在制作另一份分镜，请完成后再试');
      active.add(dir);reservation=dir;
      await fs.mkdir(dir,{recursive:true});const now=Date.now();const v={id,instance,createdAt:now,status:'generating',proposal:inp.proposal.trim(),count:inp.count,message:'正在根据方案规划镜头',shots:[]};await save(dir,v);reservation=undefined;void runJob(dir,v,action).catch(console.error);return reply(res,202,v);
    }
    const v=await read(dir);
    if(action==='confirm'){
      if(v.confirmedAt)return reply(res,200,v);
      if(v.status!=='draft' || !Array.isArray(inp.shots) || inp.shots.length!==v.shots.length)fail(409,'仅可确认已生成的完整草稿');
      v.shots=v.shots.map((s,i)=>{const edit=inp.shots[i];
        if(edit.number!==s.number || typeof edit.action!=='string'||!edit.action.trim()||edit.action.length>650||!movements.includes(edit.motion)||!Number.isFinite(edit.seconds)||edit.seconds<.5||edit.seconds>30||!Number.isInteger(edit.seconds*2))fail(400,'请核对每镜的动作、运镜及时长（半秒递增）');
        return {...s,action:edit.action.trim(),seconds:edit.seconds,motion:edit.motion};
      });v.confirmedAt=Date.now();v.status='confirmed';v.message='已确认静帧和剪辑时长';await save(dir,v);return reply(res,200,v);
    }
    if(v.status==='ready'||v.status==='rendering')return reply(res,200,v);
    if(!v.confirmedAt||v.status!=='confirmed')fail(409,'请先确认静帧版本');if(active.size)fail(409,'另一版本正在制作中');
    active.add(dir);reservation=dir;
    v.status='rendering';v.instance=instance;v.message='Remotion 正在渲染这组已确认的静帧';await save(dir,v);reservation=undefined;void runJob(dir,v,action).catch(console.error);reply(res,202,v);
  }catch(e){if(res.headersSent){res.destroy();return;}reply(res,e.status || (e.code==='ENOENT'?404:500),{error:e.status?e.message:'无法读取本机分镜记录'});}
  finally{if(reservation)active.delete(reservation);if(lock)locks.delete(lock);}
}
