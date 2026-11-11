const PROJECTS=[{id:'e720341d-bfb9-43ac-bbc6-04096970e172',name:'广告创作'},{id:'ea2e745f-206d-447c-85f9-4e0cc3a68849',name:'开放创新公司'},{id:'27655482-d32c-4082-810b-c9078c7a6245',name:'日常管理'}];
const STATES=['待开始','进行中','等待确认','已完成','已归档'];
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers});
const tools=[
{name:'list_workbench_projects',description:'列出黑曼巴工作台允许的三个 Codex 项目。仅登记映射，不启动或控制 Codex。',inputSchema:{type:'object',properties:{},additionalProperties:false}},
{name:'list_workbench_tasks',description:'读取当前用户私有云端任务，最多100条。返回真实任务状态和revision；不启动任务。',inputSchema:{type:'object',properties:{project:{type:'string',enum:PROJECTS.map(p=>p.name)},status:{type:'string',enum:STATES}},additionalProperties:false}},
{name:'get_workbench_task',description:'读取当前用户任务详情及最新revision。',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false}},
{name:'create_workbench_task',description:'在用户指定的三个项目之一创建任务记录。不执行任务。仅在用户明确要求创建时调用；request_id使用唯一UUID，重试保持相同。',inputSchema:{type:'object',properties:{project:{type:'string',enum:PROJECTS.map(p=>p.name)},name:{type:'string',maxLength:100},notes:{type:'string',maxLength:10000},request_id:{type:'string'}},required:['project','name','request_id'],additionalProperties:false}},
{name:'update_workbench_task',description:'按明确授权回写任务状态或实际成果，不执行Codex。先读取最新revision，冲突时重新读取，禁止覆盖。request_id使用唯一UUID，重试保持相同。',inputSchema:{type:'object',properties:{id:{type:'string'},revision:{type:'integer',minimum:1},status:{type:'string',enum:STATES},result:{type:'string',maxLength:15000},request_id:{type:'string'}},required:['id','revision','request_id'],additionalProperties:false}}
];
function err(message,status=400){throw Object.assign(new Error(message),{status})}
function str(v,max,required=false){if(typeof v!=='string'||v.length>max||(required&&!v.trim()))err('字段格式无效');return v.trim()}
function rid(v){if(typeof v!=='string'||!/^[-a-zA-Z0-9_]{16,100}$/.test(v))err('request_id需为16至100位唯一标识');return v}
async function action(name,args,env,owner){
 if(name==='list_workbench_projects')return {projects:PROJECTS,execution:'未连接自动执行；由 Codex 在用户指令下调用任务工具'};
 if(!env.DB)err('云端数据库暂不可用',503);
 if(name==='list_workbench_tasks'){
 let q='SELECT * FROM tasks WHERE owner = ?',p=[owner];if(args.project){if(!PROJECTS.some(x=>x.name===args.project))err('不在授权项目范围');q+=' AND project = ?';p.push(args.project)}if(args.status){if(!STATES.includes(args.status))err('无效状态');q+=' AND status = ?';p.push(args.status)}const r=await env.DB.prepare(q+' ORDER BY updated_at DESC LIMIT 100').bind(...p).all();return {tasks:r.results.map(({owner,last_request,...x})=>x),limit:100};}
 if(name==='get_workbench_task') {const row=await env.DB.prepare('SELECT * FROM tasks WHERE id = ? AND owner = ?').bind(str(args.id,120,true),owner).first();if(!row)err('任务不存在或无访问权限',404);const {owner:_,last_request,...task}=row;return {task};}
 if(name==='create_workbench_task'){
 const request=rid(args.request_id),project=str(args.project,100,true);if(!PROJECTS.some(x=>x.name===project))err('不在授权项目范围');const title=str(args.name,100,true),notes=str(args.notes??'',10000),now=Date.now();const id=request;
 const r=await env.DB.prepare('INSERT INTO tasks (id,owner,project,name,notes,status,result,created_at,updated_at,revision,last_request) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,owner,project,title,notes,'待开始','',now,now,1,request).run();const found=await action('get_workbench_task',{id},env,owner);if(found.task.project!==project||found.task.name!==title)err('request_id已被用于另一项任务',409);return {...found,created:!!r.meta.changes};}
 if(name==='update_workbench_task'){
 const id=str(args.id,120,true),request=rid(args.request_id);if(!Number.isSafeInteger(args.revision)||args.revision<1)err('缺少有效revision');if(args.status===undefined&&args.result===undefined)err('至少提供状态或成果');if(args.status!==undefined&&!STATES.includes(args.status))err('无效状态');if(args.result!==undefined)str(args.result,15000);
 const old=await env.DB.prepare('SELECT * FROM tasks WHERE id = ? AND owner = ?').bind(id,owner).first();if(!old)err('任务不存在或无访问权限',404);if(old.last_request===request)return action('get_workbench_task',{id},env,owner);
 const out=await env.DB.prepare('UPDATE tasks SET status = ?, result = ?, updated_at = ?, revision = revision + 1, last_request = ? WHERE id = ? AND owner = ? AND revision = ?').bind(args.status??old.status,args.result??old.result,Date.now(),request,id,owner,args.revision).run();if(!out.meta.changes)err('任务已被更新，请重新读取后确认修改',409);return action('get_workbench_task',{id},env,owner);}
 err('工具不存在',404);
}
export default {async fetch(request,env){const url=new URL(request.url);try{
 if(url.pathname==='/mcp'){
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 const owner=request.headers.get('oai-authenticated-user-id');if(!owner)return json({error:'请使用官方连接并登录'},401);
 const raw=await request.text();if(raw.length>30000)return json({error:'请求过大'},413);let body;try{body=JSON.parse(raw)}catch{return json({error:'无效JSON'},400)}const id=body.id??null;
 if(body.method==='server/discover')return json({jsonrpc:'2.0',id,result:{supportedVersions:['2026-07-28'],capabilities:{tools:{}}}});
 if(body.method==='initialize')return json({jsonrpc:'2.0',id,result:{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'blackmamba-workbench',version:'1.0.0'}}});
 if(body.method==='notifications/initialized')return new Response(null,{status:204});
 if(body.method==='tools/list')return json({jsonrpc:'2.0',id,result:{tools}});
 if(body.method==='tools/call'){try{const value=await action(body.params?.name,body.params?.arguments??{},env,owner);return json({jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value}})}catch(e){return json({jsonrpc:'2.0',id,result:{isError:true,content:[{type:'text',text:e.status?e.message:'服务暂不可用，请稍后重新读取状态'}]}})}}
 return json({jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}});
 }
 if(url.pathname==='/api/workbench'){
 const owner=request.headers.get('oai-authenticated-user-id');if(!owner)return json({error:'需要登录，请重新打开站点。'},401);
 if(request.method==='GET')return json(await action('list_workbench_tasks',{},env,owner));
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 if(request.headers.get('origin')!==url.origin)return json({error:'不允许跨站请求'},403);
 if(!(request.headers.get('content-type')||'').startsWith('application/json'))return json({error:'仅接受JSON'},415);
 const raw=await request.text();if(raw.length>30000)return json({error:'请求过大'},413);const b=JSON.parse(raw);return json(await action(b.action,b.args??{},env,owner));
 }
 if(request.method!=='GET')return new Response('Not found',{status:404});
 const asset=ASSETS[url.pathname==='/'?'/index.html':url.pathname];if(!asset)return new Response('Not found',{status:404});return new Response(asset.binary ? Uint8Array.from(atob(asset.body), c => c.charCodeAt(0)) : asset.body,{headers:{'Content-Type':asset.type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'"}});
 }catch(e){return json({error:e.status?e.message:'服务暂不可用，请稍后重试。'},e.status||500)}}};
