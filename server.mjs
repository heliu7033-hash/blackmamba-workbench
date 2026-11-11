import http from 'node:http';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import worker from './local-dist/worker.mjs';
import {createProductionMaterials} from './production-materials.mjs';
import {createCreativeChat} from './creative-chat.mjs';
import {storyboardRequest} from './storyboards.mjs';
import {createMediaLibrary} from './media-library.mjs';
import {libraryPage} from './local-library.mjs';
import {scanSkills} from './skills-inventory.mjs';
const ROOT=path.dirname(fileURLToPath(import.meta.url));process.chdir(ROOT);
const PORT=Number(process.env.MAMBA_PORT||18771),HOST='127.0.0.1',ORIGIN=`http://${HOST}:${PORT}`;
const data=path.resolve(process.env.MAMBA_DATA_DIR||path.join(ROOT,'data'));fs.mkdirSync(data,{recursive:true});
const db=new DatabaseSync(path.join(data,'tasks.sqlite'));db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'").get()){
 db.exec(fs.readFileSync('drizzle/0000_groovy_starjammers.sql','utf8'));
 const seed=path.join(data,'cloud-snapshot-20261108.json');
 if(fs.existsSync(seed)){for(const t of JSON.parse(fs.readFileSync(seed)).tasks||[])db.prepare('INSERT OR IGNORE INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(t.id,'local-owner',t.project,t.name,t.notes,t.status,t.result,t.created_at,t.updated_at,t.revision,'import-snapshot');}
}
const env = { DB: {
 prepare(sql) {
  let args=[];
  return {
   bind(...a) {args=a;return this;},
   async first() {return db.prepare(sql).get(...args);},
   async all() {return {results:db.prepare(sql).all(...args)};},
   async run() {return {meta:{changes:db.prepare(sql).run(...args).changes}};}
  };
 }
}};
const creativeChat=createCreativeChat(data);
const productionMaterials=createProductionMaterials(data);
let mediaLibrary;
const server=http.createServer(async(req,res)=>{
 const deny=(status,message)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:message}));};
 if(req.headers.host!==`${HOST}:${PORT}`)return deny(403,'只允许本机固定地址');
 if(req.headers.origin&&req.headers.origin!==ORIGIN)return deny(403,'不允许跨站请求');
 if(req.headers['sec-fetch-site']==='cross-site')return deny(403,'不允许跨站请求');
 if(req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify({app:'blackmamba-local',mode:'local',version:1,instance:process.env.MAMBA_INSTANCE}));}
 let target;try{target=new URL(req.url,ORIGIN);}catch{return deny(400,'无效地址');}
 if(target.origin!==ORIGIN||target.pathname==='/mcp'||!['GET','POST'].includes(req.method))return deny(404,'未开放此接口');
 if(target.pathname.startsWith('/api/materials/'))return productionMaterials.request(req,res,target,ORIGIN);
 if(target.pathname.startsWith('/api/creative/'))return creativeChat.request(req,res,target,ORIGIN);
 if(target.pathname.startsWith('/api/media/')){
  try{mediaLibrary ||= createMediaLibrary(data);return mediaLibrary.request(req,res,target);}catch{return deny(500,'素材索引读取失败，请检查本机数据目录');}
 }
 if(target.pathname.startsWith('/api/storyboards/'))return storyboardRequest(req,res,target,data,ORIGIN);
 if(target.pathname==='/api/local-library'){
  if(req.method!=='GET') return deny(405,'本地资料仅支持读取');
  try{
   const page=libraryPage(data,target.searchParams);
   res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff'});
   return res.end(JSON.stringify(page));
  }catch{return deny(500,'本机资料索引读取失败');}
 }
 if(target.pathname==='/api/skills'){
  if(req.method!=='GET'||target.search)return deny(405,'技能清单仅支持不带参数的只读查询');
  try{res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'});return res.end(JSON.stringify(scanSkills()));}
  catch{return deny(500,'技能清单读取失败，项目数据未改动');}
 }
 let size=0,chunks=[];try{
 for await(const c of req){size+=c.length;if(size>30000){deny(413,'请求过大');return;}chunks.push(c);}
 const headers=new Headers(req.headers);headers.set('oai-authenticated-user-id','local-owner');
 const request=new Request(target,{method:req.method,headers,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})});
 const out=await worker.fetch(request,env);res.writeHead(out.status,{...Object.fromEntries(out.headers),'X-Frame-Options':'DENY'});res.end(Buffer.from(await out.arrayBuffer()));
 }catch{deny(500,'本地请求失败，现有数据未清空');}
});
server.listen(PORT,HOST,()=>console.log(`黑曼巴本地工作台 ${ORIGIN}`));
server.on('error',e=>{console.error(e.message);process.exitCode=1;});
process.on('SIGTERM',()=>server.close(()=>{db.close();process.exit(0)}));
