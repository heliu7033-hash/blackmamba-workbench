import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {createCreativeChat,validateReply,questionSchema} from '../creative-chat.mjs';
import {runProvider,withMcp,listMcpTools,endpointURL} from '../creative-providers.mjs';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mamba-chat-test-'));
const question={type:'question',summary:'测试简报：聚焦通勤者。',question:'优先突出哪个价值？',options:[{label:'情绪',question:'从下班后的松弛切入吗？',reason:'侧重情绪共鸣。'},{label:'场景',question:'从地铁通勤的具体场景切入吗？',reason:'便于识别日常需求。'},{label:'体验',question:'从产品使用体验切入吗？',reason:'突出可展示的特点。'}],draft:''};
let mode='normal',calls=0;
const chat=createCreativeChat(dir,{provider:async(_,prompt,schema)=>{calls++;await new Promise(r=>setTimeout(r,15));if(mode==='bad')return {...question,options:question.options.slice(0,2)};if(mode==='error')throw Error('模拟连接中断');assert.match(prompt,/不得调用任何工具/);return schema===questionSchema?question:{type:'draft',summary:'根据选择生成',question:'',options:[],draft:'测试完整文案。'};}});
async function settled(id){for(let n=0;n<200;n++){const s=await chat.state(id);if(s.status!=='running')return s;await new Promise(r=>setTimeout(r,10));}throw Error('timeout');}
async function turn(id,action,extra={}){const s=await chat.state(id);return chat.turn(id,{requestId:randomUUID(),revision:s.revision,agentId:'codex-local',action,...extra});}
try {
  assert.throws(()=>validateReply({...question,type:'draft'},'question'));
  assert.throws(()=>validateReply({...question,options:[question.options[0],question.options[0],question.options[2]]},'question'));
  assert.throws(()=>validateReply({...question,draft:'绕过流程'},'question'));
  await assert.rejects(turn('A','draft'),/先完成/);
  const req={requestId:randomUUID(),revision:0,agentId:'codex-local',action:'start',message:'为通勤饮品构思广告',context:{name:'隔离测试',notes:'非客户资料'}};
  await chat.turn('A',req);await chat.turn('A',req);assert.equal(calls,1);
  await assert.rejects(turn('A','refine',{message:'重复请求'}),/正在思考/);
  let s=await settled('A');assert.equal(s.status,'question');assert.equal(s.pending.options.length,3);
  await assert.rejects(chat.turn('A',{...req,requestId:randomUUID()}),/已更新/);
  await assert.rejects(turn('A','answer',{questionId:'wrong',optionId:'1'}),/过期/);
  await turn('A','refine',{message:'不要泛泛而谈，针对年轻用户'});s=await settled('A');assert.equal(s.phase,0);
  for(let i=0;i<3;i++){
    s=await chat.state('A');await turn('A','answer',{questionId:s.pending.id,optionId:String(i+1),message:'按这个方向继续'});s=await settled('A');
    assert.equal(s.phase,i+1);if(i<2)await assert.rejects(turn('A','draft'),/先完成/);
  }
  assert.equal(s.status,'ready');await turn('A','draft');s=await settled('A');assert.equal(s.status,'draft');assert.equal(s.draft.draft,'测试完整文案。');
  const reloaded=createCreativeChat(dir);assert.equal((await reloaded.state('A')).draft.id,s.draft.id);assert.equal((await reloaded.state('B')).messages.length,0);
  await turn('A','refine',{message:'改成更温柔的语气'});s=await settled('A');await assert.rejects(turn('A','draft'),/先完成/);
  await turn('A','answer',{questionId:s.pending.id,message:'自定义：平静、克制'});s=await settled('A');assert.equal(s.status,'ready');
  mode='bad';await turn('B','start',{message:'请直接给文案',context:{name:'规则测试',notes:''}});s=await settled('B');assert.equal(s.status,'failed');assert.equal(s.messages.length,1);assert.match(s.error,/至少三个/);
  mode='normal';await turn('B','retry');s=await settled('B');assert.equal(s.status,'question');assert.equal(s.messages.length,2);
  mode='error';await turn('B','refine',{message:'调整'});s=await settled('B');assert.equal(s.status,'failed');assert.equal(s.pending,null);
  assert.equal((await chat.state('A')).status,'ready');
  assert.throws(()=>endpointURL('file:///etc/passwd'));assert.throws(()=>endpointURL('https://u:secret@example.com/mcp'));assert.throws(()=>endpointURL('http://example.com/mcp'));
  console.log('PASS creative gates: three rounds, custom direction, refinement, final confirmation, invalid reply, retry, stale writes, idempotency, persistence, project isolation');
  let sse=false,called=0,deleted=0;
  const server=http.createServer(async(req,res)=>{
    if(req.method==='DELETE'){deleted++;res.writeHead(200);return res.end();}
    const chunks=[];for await(const c of req)chunks.push(c);const v=JSON.parse(Buffer.concat(chunks));let result;
    if(v.method==='initialize'){result={protocolVersion:'2025-06-18',capabilities:{tools:{}}};res.setHeader('mcp-session-id','test-session');}
    else {assert.equal(req.headers['mcp-session-id'],'test-session');assert.equal(req.headers['mcp-protocol-version'],'2025-06-18');}
    if(v.method==='notifications/initialized'){res.writeHead(202);return res.end();}
    if(v.method==='tools/list')result=v.params.cursor?{tools:[{name:'chat',inputSchema:{type:'object',properties:{prompt:{type:'string'},audience:{type:'string'}},required:['prompt','audience']}}]}:{tools:[],nextCursor:'next'};
    if(v.method==='tools/call'){called++;assert.equal(v.params.arguments.prompt,'test prompt');assert.equal(v.params.arguments.audience,'public');result={content:[{type:'text',text:JSON.stringify(question)}]};}
    const response={jsonrpc:'2.0',id:v.id,result};
    if(sse){res.setHeader('content-type','text/event-stream');res.write(': ping\n\n');res.write('data: '+JSON.stringify({jsonrpc:'2.0',method:'notifications/progress',params:{}})+'\n\n');res.write('data: '+JSON.stringify(response)+'\n');setTimeout(()=>res.end('\n'),10);}
    else{res.setHeader('content-type','application/json');res.end(JSON.stringify(response));}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
    const agent={kind:'mcp',url:'http://127.0.0.1:'+server.address().port+'/mcp',tool:'chat',inputKey:'prompt',arguments:{audience:'public'}};
    assert.equal((await withMcp(agent,listMcpTools)).length,1);
    assert.deepEqual(await runProvider(agent,'test prompt',questionSchema),question);
    sse=true;assert.deepEqual(await runProvider(agent,'test prompt',questionSchema),question);
    await assert.rejects(runProvider({...agent,arguments:{}},'test prompt',questionSchema),/必填/);
    assert.equal(called,2);assert.equal(deleted,4);
    console.log('PASS MCP: initialize, session headers, paginated discovery, required input mapping, JSON and streamed SSE results, session cleanup');
  }finally{await new Promise(r=>server.close(r));}
}finally{await fs.rm(dir,{recursive:true,force:true});}
