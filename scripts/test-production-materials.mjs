import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {createProductionMaterials,validateShotPlan,mcpImage} from '../production-materials.mjs';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'mamba-materials-test-'));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=','base64');
const plan={style:'白色几何体，蓝色背景',ratio:'16:9',shots:[1,2].map(number=>({action:'镜头 '+number,prompt:'A white sphere on blue',seconds:2,motion:'still'}))};
assert.equal(validateShotPlan(plan).shots.length,2);assert.throws(()=>validateShotPlan({...plan,ratio:'bad'}));
const question={type:'question',summary:'待确认镜头方向',question:'哪一种构图？',options:[1,2,3].map(n=>({label:'方向'+n,question:'选择第'+n+'种构图吗？',reason:'适用不同节奏'})),draft:''};
let failSecond=true,frames=0,seen=[];
const service=createProductionMaterials(root,{chatProvider:async(a,p,s)=>s.properties.type.enum[0]==='question'?question:{type:'draft',summary:'镜头表',question:'',options:[],draft:JSON.stringify(plan)},frame:async({dir,number,reference})=>{frames++;seen.push({number,reference});if(number===2&&failSecond)throw Error('模拟第二镜失败');await fs.writeFile(path.join(dir,'frame.jpg'),png);return {file:'frame.jpg',mime:'image/png'};}});
let origin;const server=http.createServer((req,res)=>service.request(req,res,new URL(req.url,origin),root)); // overridden origin below
server.removeAllListeners('request');server.on('request',(req,res)=>service.request(req,res,new URL(req.url,origin),origin));
await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
async function request(route,body,options={}){const r=await fetch(origin+'/api/materials/'+route,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json',Origin:origin}:{}),...options.headers},body:body?JSON.stringify(body):undefined,...(options.raw?{method:'POST',body:options.raw}:{} )});const d=await r.json();return {status:r.status,data:d};}
async function settled(){for(let n=0;n<200;n++){const s=await service.planner.state('test');if(s.status!=='running')return s;await new Promise(r=>setTimeout(r,10));}throw Error('chat timed out');}
async function turn(s,action,extra={}){const out=await request('chat/projects/test/turn',{action,agentId:'codex-local',requestId:randomUUID(),revision:s.revision,context:{name:'测试项目',notes:'合成测试文案',sourceId:'copy-1',sourceTitle:'文案第 1 稿'},...extra});assert.equal(out.status,202,JSON.stringify(out));return settled();}
try{
 assert.equal((await request('projects/test/generate/'+randomUUID(),{consent:true,plan,planId:'missing'})).status,409);
 let s=await service.planner.state('test');s=await turn(s,'start',{message:'请帮我拆镜头'});
 for(let i=0;i<3;i++)s=await turn(s,'answer',{questionId:s.pending.id,optionId:'1'});
 s=await turn(s,'draft');assert.equal(s.draft.plan.shots.length,2);assert.equal(s.draft.sourceDraft.id,'copy-1');
 const changed={name:'测试项目',notes:'不同的新稿',sourceId:'copy-new',sourceTitle:'文案第 2 稿'};
 const stale=await request('chat/projects/test/turn',{action:'draft',agentId:'codex-local',requestId:randomUUID(),revision:s.revision,context:changed});assert.equal(stale.status,409);assert.match(stale.data.error,/文案来源/);
 const jobId=randomUUID(),req={consent:true,planId:s.draft.id,plan,providerId:'codex-local'};
 assert.equal((await request('projects/test/generate/'+jobId,req)).status,202);
 async function jobDone(){for(let i=0;i<200;i++){const d=await service.load('test');if(d.jobs[0].status!=='running')return d;await new Promise(r=>setTimeout(r,10));}throw Error('job timeout');}
 let d=await jobDone();assert.equal(d.jobs[0].status,'partial');assert.equal(d.assets.length,1);assert.equal(frames,2);
 assert.equal((await request('projects/test/generate/'+jobId,req)).status,200);assert.equal(frames,2);
 failSecond=false;await request('projects/test/resume/'+jobId,{consent:true});d=await jobDone();assert.equal(d.assets.length,2);assert.equal(frames,3);assert.equal(d.jobs[0].status,'complete');assert.ok(seen.at(-1).reference);
 const assetId=randomUUID(),headers={Origin:origin,'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent('本地图片.png'),'X-Category':encodeURIComponent('参考素材')};
 let up=await request('projects/test/upload/'+assetId,null,{raw:png,headers});assert.equal(up.status,201); // content dedup with existing generated image
 assert.equal((await service.load('test')).assets.length,2);
 const raw=Buffer.concat([png,Buffer.from('different')]);up=await request('projects/test/upload/'+assetId,null,{raw,headers});assert.equal(up.status,201);assert.equal(up.data.name,'本地图片.png');
 await request('projects/test/upload/'+assetId,null,{raw,headers});d=await service.load('test');assert.equal(d.assets.length,3);
 const media=await fetch(origin+'/api/materials/projects/test/file/'+assetId,{headers:{Range:'bytes=-4'}});assert.equal(media.status,206);assert.equal((await media.arrayBuffer()).byteLength,4);
 assert.equal((await request('projects/other')).data.assets.length,0);
 assert.equal((await request('projects/test/asset/'+assetId,{revision:d.revision-1,category:'参考素材',status:'已确认',shot:1})).status,409);
 assert.equal((await request('projects/test/asset/'+assetId,{revision:d.revision,category:'分镜图',status:'已确认',shot:2})).status,200);
 assert.equal((await request('projects/test/upload/'+randomUUID(),null,{raw:Buffer.from('<script>bad</script>'),headers})).status,400);
 assert.equal((await request('projects/test/upload/'+randomUUID(),null,{raw:png,headers:{...headers,Origin:'https://evil.test'}})).status,403);
 const video=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypmp42'),Buffer.alloc(24)]),exportId=randomUUID(),exportHeaders={...headers,'X-File-Name':'cut.mp4','X-Purpose':'resolve-export'};
 const exported=await request('projects/test/upload/'+exportId,null,{raw:video,headers:exportHeaders});assert.equal(exported.status,201);assert.equal(exported.data.purpose,'resolve-export');assert.equal(exported.data.kind,'video');
 assert.equal((await request('projects/test/upload/'+exportId,null,{raw:video,headers:{...exportHeaders,'X-Purpose':'ae-export'}})).status,409);
 assert.equal((await request('projects/test/upload/'+randomUUID(),null,{raw:png,headers:exportHeaders})).status,400);
 const ae=await request('projects/test/upload/'+randomUUID(),null,{raw:video,headers:{...exportHeaders,'X-Purpose':'ae-export'}});assert.equal(ae.status,201);assert.notEqual(ae.data.id,exported.data.id);
 const ranged=await fetch(origin+'/api/materials/projects/test/file/'+exportId,{headers:{Range:'bytes=4-11'}});assert.equal(ranged.status,206);assert.equal(await ranged.text(),'ftypmp42');
 const restored=createProductionMaterials(root);assert.equal((await restored.load('test')).assets.length,5);
 s=await turn(s,'refine',{message:'换一稿重新拆分',context:{name:'测试项目',notes:'新的测试文案',sourceId:'copy-2',sourceTitle:'文案第 2 稿'}});assert.equal(s.phase,0);assert.equal(s.answers.length,0);assert.equal(s.context.sourceDraft.id,'copy-2');
 s=await turn(s,'rebase',{context:changed});assert.equal(s.phase,0);assert.equal(s.answers.length,0);assert.equal(s.draft,null);assert.equal(s.context.sourceDraft.id,'copy-new');
 console.log('PASS material question gates, source revisions, partial results, missing-shot resume, request idempotency, reference continuity, local import/dedup, MIME guard, range, status revision, project isolation and restart');
}finally{await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});}
// Test the real MCP adapter against a protocol fixture, not a fabricated provider result.
const mcp=http.createServer(async(req,res)=>{if(req.method==='DELETE'){res.writeHead(200);res.end();return;}let chunks=[];for await(const c of req)chunks.push(c);const q=JSON.parse(Buffer.concat(chunks));if(q.method==='notifications/initialized'){res.writeHead(202);res.end();return;}const result=q.method==='initialize'?{protocolVersion:'2025-06-18',capabilities:{tools:{}}}:q.method==='tools/list'?{tools:[{name:'image',inputSchema:{type:'object',properties:{prompt:{type:'string'}},required:['prompt']}}]}:{content:[{type:'image',mimeType:'image/png',data:png.toString('base64')}]};res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));});
await new Promise(r=>mcp.listen(0,'127.0.0.1',r));try{const out=await mcpImage({url:'http://127.0.0.1:'+mcp.address().port,tool:'image',inputKey:'prompt',arguments:{}},'test frame');assert.equal(out.mime,'image/png');assert.deepEqual(out.bytes,png);console.log('PASS MCP image protocol, tool mapping, native image content and local byte decoding');}finally{await new Promise(r=>mcp.close(r));}
