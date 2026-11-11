import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const execute=promisify(execFile), here=path.dirname(fileURLToPath(import.meta.url));
const extensions={audio:['wav','mp3','aac','m4a','aif','aiff','flac','ogg','wma'],video:['mp4','mov','m4v','mkv','avi','webm','mxf','mts','m2ts'],image:['jpg','jpeg','png','webp','gif','bmp','tif','tiff','heic']};
const types=Object.fromEntries(Object.entries(extensions).flatMap(([kind,exts])=>exts.map(ext=>['.'+ext,kind])));
const mime={'.mp4':'video/mp4','.mov':'video/quicktime','.m4v':'video/mp4','.webm':'video/webm','.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.aac':'audio/aac','.ogg':'audio/ogg','.flac':'audio/flac','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif','.bmp':'image/bmp'};
function error(message,status=400){return Object.assign(new Error(message),{status});}
function binary(name){const choices=[process.env['MAMBA_'+name.toUpperCase()],path.join(os.homedir(),'.local/bin',name),'/opt/homebrew/bin/'+name,'/usr/local/bin/'+name,'/usr/bin/'+name];return choices.find(p=>p&&fs.existsSync(p));}
function send(res,status,body){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));}
async function body(req){let size=0,parts=[];for await(const part of req){size+=part.length;if(size>16000)throw error('请求过大',413);parts.push(part);}try{return JSON.parse(Buffer.concat(parts));}catch{throw error('请求格式无效');}}
export function createMediaLibrary(data,options={}){
 fs.mkdirSync(data,{recursive:true});
 const configFile=path.join(data,'media-library.json'), cache=path.join(data,'media-previews');
 fs.mkdirSync(cache,{recursive:true});
 let config;
 try {config=JSON.parse(fs.readFileSync(configFile,'utf8'));} catch(e){
  if(e.code!=='ENOENT')throw e;
  let roots=[];
  try{roots=JSON.parse(fs.readFileSync(options.yikuConfig||path.join(os.homedir(),'Library/Application Support/一库/config.json'),'utf8')).roots||[];}catch{}
  config={roots:roots.filter(r=>typeof r==='string'&&path.isAbsolute(r)).map(r=>path.resolve(r))};
  fs.writeFileSync(configFile,JSON.stringify(config,null,2));
 }
 const db=new DatabaseSync(path.join(data,'media-index.sqlite'));
 db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY,path TEXT UNIQUE,root TEXT,name TEXT,kind TEXT,size INTEGER,mtime REAL,generation TEXT); CREATE INDEX IF NOT EXISTS media_kind ON media(kind); CREATE TABLE IF NOT EXISTS imports(id TEXT PRIMARY KEY,request TEXT,result TEXT,state TEXT);');
 // Translated aliases never replace the indexed name/path used for media or Resolve.
 db.exec('CREATE TABLE IF NOT EXISTS media_names(id TEXT PRIMARY KEY, original TEXT NOT NULL, display_name TEXT NOT NULL)');
 let nameWarning='';
 try{
  const catalog=JSON.parse(fs.readFileSync(path.join(data,'media-names.zh.json'),'utf8'));
  if(catalog.version!==1||!Array.isArray(catalog.entries))throw Error('Invalid name catalog');
  const rows=catalog.entries;
  if(rows.some(r=>!r||!/^[a-f0-9]{64}$/.test(r.id)||typeof r.original!=='string'||typeof r.display!=='string'||!r.display.trim()||r.display.length>1000))throw Error('Invalid name entry');
  db.exec('BEGIN');try{db.exec('DELETE FROM media_names');const putName=db.prepare('INSERT OR REPLACE INTO media_names VALUES (?,?,?)');for(const r of rows)putName.run(r.id,r.original,r.display);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 }catch(e){if(e.code!=='ENOENT')nameWarning='中文名称表未能载入，已保留上次名称；原素材仍可使用。';}
 let scanning=false, progress=0, warnings=[], lastScan=null, importBusy=false, closed=false;
 let indexRevision=0,folderCache=null;
 const previewJobs=new Map();let activePreviews=0;
 const waveformJobs=new Map();let activeWaveforms=0;
 const bridge=options.bridge|| (async payload=>{
  try{const {stdout}=await execute(binary('python3')||'/usr/bin/python3',[path.join(here,'scripts/resolve-media.py')],{timeout:20000,maxBuffer:1024*1024,env:{...process.env,MAMBA_RESOLVE_REQUEST:JSON.stringify(payload)}});return JSON.parse(stdout.trim().split('\n').at(-1));}
  catch{throw error(payload.action==='import'?'达芬奇响应超时，导入结果未确认。请先检查时间线，不要重复导入。':'无法连接达芬奇。请打开工程，并在达芬奇偏好设置中启用本地外部脚本。',503);}
 });
 const summary=()=>({roots:config.roots,scanning,progress,warnings:nameWarning?[nameWarning,...warnings]:warnings,lastScan,total:db.prepare('SELECT count(*) AS n FROM media').get().n,importLocked:!!db.prepare("SELECT id FROM imports WHERE state='pending' LIMIT 1").get()});
 const put=db.prepare('INSERT INTO media VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET root=excluded.root,name=excluded.name,kind=excluded.kind,size=excluded.size,mtime=excluded.mtime,generation=excluded.generation');
 async function scan(){
  if(scanning)return;scanning=true;progress=0;warnings=[];const generation=crypto.randomUUID();
  try{
   for(const configured of config.roots){
    let root;try{root=await fsp.realpath(configured);if(!(await fsp.stat(root)).isDirectory())throw Error();}catch{warnings.push('目录离线或无法访问：'+configured);continue;}
    const queue=[root];let failed=false;
    while(queue.length&&!closed){const dir=queue.pop();let entries;try{entries=await fsp.readdir(dir,{withFileTypes:true});}catch{warnings.push('无法读取：'+dir);failed=true;continue;}
     const rows=[];
     for(const entry of entries){if(entry.name.startsWith('.')||entry.isSymbolicLink())continue;const file=path.join(dir,entry.name);if(entry.isDirectory()){queue.push(file);continue;}const kind=types[path.extname(file).toLowerCase()];if(!entry.isFile()||!kind)continue;
      try{const stat=await fsp.stat(file);rows.push([crypto.createHash('sha256').update(file).digest('hex'),file,configured,entry.name,kind,stat.size,stat.mtimeMs,generation]);}catch{failed=true;}
     }
     if(closed)break;
     db.exec('BEGIN');try{for(const row of rows)put.run(...row);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}progress+=rows.length;indexRevision++;
     await new Promise(r=>setImmediate(r));
    }
    if(!closed&&!failed){db.prepare('DELETE FROM media WHERE root=? AND generation<>?').run(configured,generation);indexRevision++;}
   }
   if(!closed)lastScan=new Date().toISOString();
  }catch{warnings.push('扫描未完成，可重新扫描；已有索引保留。');}finally{scanning=false;}
 }
 async function directories(){
  if(folderCache?.revision===indexRevision)return folderCache.trees;
  const revision=indexRevision,roots=[...config.roots];
  const canonical=await Promise.all(roots.map(root=>fsp.realpath(root).catch(()=>root)));
  const maps=new Map(), trees=roots.map((root,i)=>{
   const item={root,path:canonical[i],name:path.basename(root),count:0,children:[]};
   maps.set(root,{base:canonical[i],items:new Map([[canonical[i],item]])});return item;
  });
  for(const row of db.prepare('SELECT root,path FROM media').all()){
   const group=maps.get(row.root);if(!group)continue;
   const relative=path.relative(group.base,path.dirname(row.path));if(relative.startsWith('..')||path.isAbsolute(relative))continue;
   let parent=group.items.get(group.base);parent.count++;
   for(const name of relative.split(path.sep).filter(Boolean)){
    const current=path.join(parent.path,name);let item=group.items.get(current);
    if(!item){item={root:row.root,path:current,name,count:0,children:[]};group.items.set(current,item);parent.children.push(item);}
    item.count++;parent=item;
   }
  }
  function sort(item){item.children.sort((a,b)=>a.name.localeCompare(b.name,'zh-CN',{numeric:true}));for(const child of item.children)sort(child);}
  trees.forEach(sort);if(revision===indexRevision)folderCache={revision,trees};return trees;
 }
 async function asset(id){
  if(typeof id!=='string')throw error('请选择素材');const row=db.prepare('SELECT * FROM media WHERE id=?').get(id);if(!row||!config.roots.includes(row.root))throw error('素材不在当前素材库中',404);
  try{const [real,root]=await Promise.all([fsp.realpath(row.path),fsp.realpath(row.root)]);const rel=path.relative(root,real);if(rel.startsWith('..')||path.isAbsolute(rel))throw Error();const stat=await fsp.stat(real);if(!stat.isFile())throw Error();return {...row,path:real,size:stat.size,mtime:stat.mtimeMs};}catch{throw error('素材已移动、被删除或所在磁盘未连接',404);}
 }
 async function preview(row,thumbnail=false,hover=false){
  const ffmpeg=binary('ffmpeg');if(!ffmpeg)throw error('此格式需要本机 ffmpeg 才能预览；原文件仍可导入达芬奇。',503);
  const key=crypto.createHash('sha256').update(`${row.id}:${row.size}:${row.mtime}:${thumbnail}:${hover}`).digest('hex');
  const ext=thumbnail||row.kind==='image'?'.jpg':row.kind==='audio'?'.m4a':'.mp4', file=path.join(cache,key+ext);
  if(fs.existsSync(file))return file;if(previewJobs.has(key))return previewJobs.get(key);if(activePreviews>=2)throw error('正在生成其他预览，请稍后重试',429);
  const job=(async()=>{activePreviews++;const temp=file+'.tmp'+ext;try{
   const args=['-nostdin','-hide_banner','-loglevel','error','-y','-i',row.path];
   if(hover)args.push('-t','12');
   if(ext==='.jpg')args.push('-frames:v','1','-vf','scale=640:640:force_original_aspect_ratio=decrease','-q:v','3');
   else if(ext==='.m4a')args.push('-vn','-c:a','aac','-b:a','160k');
   else args.push('-vf','scale=960:540:force_original_aspect_ratio=decrease:force_divisible_by=2','-c:v','libx264','-preset','veryfast','-crf','25','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart');
   args.push(temp);await execute(ffmpeg,args,{timeout:180000,maxBuffer:512000});await fsp.rename(temp,file);return file;
  }catch{throw error('预览生成失败。可尝试直接播放，或将原素材导入达芬奇。',422);}finally{activePreviews--;previewJobs.delete(key);await fsp.rm(temp,{force:true});}})();previewJobs.set(key,job);return job;
 }
 // Stream decoded samples into a fixed envelope: memory stays bounded even for long music.
 async function waveform(row){
  if(row.kind!=='audio')throw error('此素材不是音频',400);
  const key=crypto.createHash('sha256').update(`waveform-v1:${row.id}:${row.size}:${row.mtime}`).digest('hex');
  const file=path.join(cache,key+'.wave.json');
  try{return JSON.parse(await fsp.readFile(file,'utf8'));}catch{}
  if(waveformJobs.has(key))return waveformJobs.get(key);
  if(activeWaveforms>=2)throw error('波形正在排队生成',429);
  const ffmpeg=binary('ffmpeg'),ffprobe=binary('ffprobe');
  if(!ffmpeg||!ffprobe)throw error('生成波形需要本机 ffmpeg 和 ffprobe',503);
  const job=(async()=>{activeWaveforms++;const temp=file+'.tmp';try{
   const {stdout}=await execute(ffprobe,['-v','error','-select_streams','a:0','-show_entries','stream=duration,sample_rate,channels:format=duration','-of','json',row.path],{timeout:15000,maxBuffer:65536});
   const info=JSON.parse(stdout),duration=Number(info.streams?.[0]?.duration)||Number(info.format?.duration);
   if(!Number.isFinite(duration)||duration<=0)throw Error('Missing duration');
   const rate=Number(info.streams?.[0]?.sample_rate),channels=Number(info.streams?.[0]?.channels);
   if(!Number.isFinite(rate)||rate<=0||!Number.isInteger(channels)||channels<1||channels>64)throw Error('Invalid audio format');
   const peaks=new Array(128).fill(0),stride=channels*4;let frames=0,tail=Buffer.alloc(0);
   await new Promise((resolve,reject)=>{
    const child=spawn(ffmpeg,['-nostdin','-hide_banner','-loglevel','error','-i',row.path,'-map','0:a:0','-vn','-f','f32le','pipe:1'],{stdio:['ignore','pipe','ignore']});
    const timeout=setTimeout(()=>{child.kill('SIGKILL');},120000);
    child.stdout.on('data',chunk=>{const bytes=tail.length?Buffer.concat([tail,chunk]):chunk,limit=bytes.length-bytes.length%stride;
     for(let i=0;i<limit;i+=stride){let peak=0;for(let c=0;c<channels;c++)peak=Math.max(peak,Math.abs(bytes.readFloatLE(i+c*4)));const bin=Math.min(127,Math.floor(frames++/(duration*rate)*128));if(Number.isFinite(peak))peaks[bin]=Math.max(peaks[bin],peak);}
     tail=Buffer.from(bytes.subarray(limit));
    });
    child.on('error',e=>{clearTimeout(timeout);reject(e);});child.on('close',code=>{clearTimeout(timeout);code===0&&frames?resolve():reject(Error('Decode failed'));});
   });
   const amplitude=Math.max(...peaks),result={duration,peaks:peaks.map(value=>amplitude?Number((value/amplitude).toFixed(4)):0),silent:amplitude===0};
   await fsp.writeFile(temp,JSON.stringify(result));await fsp.rename(temp,file);return result;
  }catch{throw error('波形暂不可用，仍可试听或导入原素材',422);}finally{activeWaveforms--;waveformJobs.delete(key);await fsp.rm(temp,{force:true});}})();
  waveformJobs.set(key,job);return job;
 }
 async function stream(req,res,file){
  const stat=await fsp.stat(file),headers={'Content-Type':mime[path.extname(file).toLowerCase()]||'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'private, no-cache','X-Content-Type-Options':'nosniff'};
  let start=0,end=stat.size-1,status=200;
  if(req.headers.range){const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!match||(!match[1]&&!match[2]))throw error('无效播放范围',416);
   if(!match[1])start=Math.max(0,stat.size-Number(match[2]));else{start=Number(match[1]);if(match[2])end=Math.min(Number(match[2]),end);}status=206;
   if(start>end||start>=stat.size){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});return res.end();}headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;
  }
  headers['Content-Length']=Math.max(0,end-start+1);res.writeHead(status,headers);if(!stat.size)return res.end();const input=fs.createReadStream(file,{start,end});input.on('error',()=>res.destroy());res.on('close',()=>input.destroy());input.pipe(res);
 }
 async function request(req,res,url){try{
  const route=url.pathname.slice('/api/media/'.length);
  if(req.method==='GET'&&route==='status')return send(res,200,summary());
  if(req.method==='GET'&&route==='directories')return send(res,200,{trees:await directories()});
  if(req.method==='GET'&&route==='search'){
   const clauses=['1=1'],args=[];const q=(url.searchParams.get('q')||'').slice(0,240).toLowerCase();
   for(const word of q.split(/\s+/).filter(Boolean)){clauses.push("(lower(m.path) LIKE ? ESCAPE '\\' OR lower(n.display_name) LIKE ? ESCAPE '\\')");const pattern='%'+word.replace(/[\\%_]/g,'\\$&')+'%';args.push(pattern,pattern);}
   for(const key of ['kind','root'])if(url.searchParams.get(key)){clauses.push('m.'+key+'=?');args.push(url.searchParams.get(key));}
   const folder=url.searchParams.get('folder');
   if(folder){
    const trees=await directories();const root=url.searchParams.get('root');
    const contains=node=>node.path===folder||node.children.some(contains);
    if(!trees.some(tree=>tree.root===root&&contains(tree)))throw error('所选文件夹不在当前素材库中',404);
    const prefix=folder.endsWith(path.sep)?folder:folder+path.sep;
    clauses.push('substr(m.path,1,length(?))=?');args.push(prefix,prefix);
   }
   const joined=' FROM media m LEFT JOIN media_names n ON n.id=m.id AND n.original=m.name WHERE ',where=clauses.join(' AND '),total=db.prepare('SELECT count(*) AS n'+joined+where).get(...args).n,page=Math.max(0,Math.min(Math.ceil(total/36)-1,parseInt(url.searchParams.get('page'))||0));
   const rows=db.prepare('SELECT m.id,m.name,m.path,m.root,m.kind,m.size,COALESCE(n.display_name,m.name) AS displayName'+joined+where+' ORDER BY m.name COLLATE NOCASE,m.path LIMIT 36 OFFSET ?').all(...args,page*36);
   return send(res,200,{...summary(),rows,total,page,pages:Math.ceil(total/36)});
  }
  if(req.method==='GET'&&['file','thumbnail'].includes(route)){const row=await asset(url.searchParams.get('id'));let file=row.path;if(route==='thumbnail'){if(row.kind==='audio')throw error('音频没有画面',404);file=await preview(row,true);}else if(url.searchParams.get('compatible')==='1')file=await preview(row,false,url.searchParams.get('hover')==='1');return await stream(req,res,file);}
  if(req.method==='GET'&&route==='waveform')return send(res,200,await waveform(await asset(url.searchParams.get('id'))));
  if(req.method==='GET'&&route==='resolve'){if(importBusy)throw error('正在导入，请稍后刷新',409);return send(res,200,await bridge({action:'status'}));}
  if(req.method!=='POST')throw error('未开放此接口',404);
  if(!req.headers['content-type']?.startsWith('application/json'))throw error('需要 JSON 请求',415);
  const input=await body(req);
  if(route==='roots'){
   if(scanning)throw error('请等待当前扫描完成再修改目录',409);
   if(!Array.isArray(input.roots)||input.roots.length>30||input.roots.some(r=>typeof r!=='string'||!path.isAbsolute(r)||r==='/'||r.length>2048))throw error('请输入有效的素材文件夹绝对路径（最多 30 个，不允许磁盘根目录）');
   config={roots:[...new Set(input.roots.map(r=>path.resolve(r)))]};fs.writeFileSync(configFile+'.tmp',JSON.stringify(config,null,2));fs.renameSync(configFile+'.tmp',configFile);
   const keep=new Set(config.roots);for(const {root} of db.prepare('SELECT DISTINCT root FROM media').all())if(!keep.has(root))db.prepare('DELETE FROM media WHERE root=?').run(root);
   indexRevision++;void scan();return send(res,200,summary());
  }
  if(route==='scan'){void scan();return send(res,200,summary());}
  if(route==='unlock'){
   if(importBusy)throw error('正在导入，不能解除锁定',409);
   db.prepare("UPDATE imports SET state='reviewed' WHERE state='pending'").run();return send(res,200,summary());
  }
  if(route==='import'){
   if(typeof input.requestId!=='string'||!/^[a-f0-9-]{36}$/.test(input.requestId))throw error('导入请求标识无效');
   const serialized=JSON.stringify(input),old=db.prepare('SELECT * FROM imports WHERE id=?').get(input.requestId);
   if(old){if(old.request!==serialized)throw error('请求标识已被使用',409);if(old.result)return send(res,200,JSON.parse(old.result));throw error('此导入结果尚未确认，请检查达芬奇时间线',409);}
   if(importBusy||summary().importLocked)throw error('上次导入尚未完成或结果未确认，请先检查时间线',409);
   const row=await asset(input.id);
   if(!['end','playhead'].includes(input.position)||!['both','video'].includes(input.videoMode)||!Number.isInteger(input.videoTrack)||input.videoTrack<1||!Number.isInteger(input.audioTrack)||input.audioTrack<1||!input.projectId||!input.timelineId)throw error('请刷新达芬奇连接并选择导入轨道');
   // Recheck after asynchronous file validation to serialize concurrent clicks.
   if(importBusy||summary().importLocked)throw error('正在处理另一次导入',409);
   importBusy=true;db.prepare('INSERT INTO imports VALUES (?,?,NULL,?)').run(input.requestId,serialized,'pending');
   try{const result=await bridge({...input,action:'import',path:row.path,kind:row.kind});db.prepare('UPDATE imports SET result=?,state=? WHERE id=?').run(JSON.stringify(result),result.uncertain?'pending':'done',input.requestId);return send(res,200,result);}finally{importBusy=false;}
  }
  throw error('未开放此接口',404);
 }catch(e){if(!res.headersSent)send(res,e.status||500,{error:e.status?e.message:'素材服务暂不可用，请稍后重试'});else res.destroy();}}
 return {request,scan,summary,close(){closed=true;db.close();}};
}
