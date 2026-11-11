import {codexCommand} from './runtime-platform.mjs';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

export function codexBinary(){try{return codexCommand().file;}catch{return undefined;}}
export async function runCodex(prompt,schema) {
  const command=codexCommand();
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'mamba-copy-'));
  try {
    await fs.writeFile(path.join(cwd,'schema.json'),JSON.stringify(schema));
    const args=['exec','--ephemeral','--ignore-user-config','--disable','apps','--disable','shell_tool','--disable','image_generation','--sandbox','read-only','--skip-git-repo-check','--output-schema','schema.json','--json','-'];
    const output=await new Promise((resolve,reject)=>{
      const child=spawn(command.file,[...command.args,...args],{cwd,stdio:['pipe','pipe','pipe'],env:command.env,windowsHide:true});
      let out='',err='',timedOut=false;
      const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},180000);
      const force=setTimeout(()=>child.kill('SIGKILL'),185000);
      child.on('error',()=>{clearTimeout(timer);clearTimeout(force);reject(Error('无法启动本机 Codex。'));});
      child.stdout.setEncoding('utf8').on('data',s=>{out=(out+s).slice(-1500000);});
      child.stderr.setEncoding('utf8').on('data',s=>{err=(err+s).slice(-3000);});
      child.on('close',code=>{clearTimeout(timer);clearTimeout(force);if(!code&&!timedOut)resolve(out);else reject(Error(timedOut?'智能体响应超时，可重试本轮。':/login|sign in|authenticat/i.test(err)?'请先在本机 Codex 完成登录。':'Codex 未完成本轮，请检查网络和账号状态后重试。'));});
      child.stdin.on('error',()=>{});child.stdin.end(prompt);
    });
    const events=output.split('\n').flatMap(s=>{try{return [JSON.parse(s)];}catch{return [];}});
    const result=events.filter(e=>e.item?.type==='agent_message').at(-1)?.item.text;
    try{return JSON.parse(result);}catch{throw Error('智能体没有返回有效的结构化问答，可重试本轮。');}
  }finally{await fs.rm(cwd,{recursive:true,force:true});}
}

export function endpointURL(value) {
  let u;try{u=new URL(value);}catch{throw Error('请输入有效的 MCP 地址。');}
  if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.hash||u.search)throw Error('MCP 地址需为不含凭据、查询参数或片段的 HTTP(S) 地址。');
  if(u.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw Error('远程 MCP 连接请使用 HTTPS。');
  return u.href;
}
export async function withMcp(agent,work,{maxBytes=1500000,timeoutMs=180000}={}) {
  const endpoint=endpointURL(agent.url);let session,version='2025-06-18',sequence=0;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  const headers=()=>({'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':version,...(session?{'Mcp-Session-Id':session}:{}),...(agent.tokenEnv?{Authorization:'Bearer '+(process.env[agent.tokenEnv]||'')}: {})});
  if(agent.tokenEnv&&!process.env[agent.tokenEnv]){clearTimeout(timer);throw Error('MCP 认证环境变量尚未配置到工作台服务。');}
  async function rpc(method,params,notification=false) {
    const id=++sequence;
    const r=await fetch(endpoint,{method:'POST',headers:headers(),body:JSON.stringify({jsonrpc:'2.0',...(!notification?{id}:{}),method,params}),redirect:'error',signal:controller.signal});
    if(!r.ok){await r.body?.cancel();throw Error(r.status===401||r.status===403?'MCP 认证失败，请检查服务授权。':'MCP 服务响应失败（HTTP '+r.status+'）。');}
    if(method==='initialize')session=r.headers.get('mcp-session-id');
    if(notification){await r.body?.cancel();return;}
    const reader=r.body.getReader(),decoder=new TextDecoder();let buffer='',bytes=0;
    const sse=(r.headers.get('content-type')||'').includes('text/event-stream');
    function result(message){if(message.id!==id)return; if(message.error)throw Error('MCP 拒绝了 '+method+' 请求。');if(!('result' in message))throw Error('MCP 返回格式无效。');return {value:message.result};}
    try {
      while(true){
        const {done,value}=await reader.read();if(done)break;
        bytes+=value.length;if(bytes>maxBytes)throw Error('MCP 回复过大。');buffer+=decoder.decode(value,{stream:true});
        if(sse){buffer=buffer.replace(/\r\n/g,'\n');let end;while((end=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!data)continue;const out=result(JSON.parse(data));if(out)return out.value;}}
      }
      if(!sse){const out=result(JSON.parse(buffer));if(out)return out.value;}
      throw Error('MCP 没有返回匹配的结果。');
    }finally{await reader.cancel().catch(()=>{});}
  }
  try {
    const init=await rpc('initialize',{protocolVersion:version,capabilities:{},clientInfo:{name:'blackmamba-creative',version:'1.0.0'}});
    if(!['2025-06-18','2025-03-26','2025-11-25'].includes(init.protocolVersion)||!init.capabilities?.tools)throw Error('此 MCP 服务不支持所需的工具协议。');
    version=init.protocolVersion;await rpc('notifications/initialized',{},true);
    return await work(rpc);
  }catch(e){if(e.name==='AbortError')throw Error('MCP 响应超时，可重试本轮。');if(e instanceof TypeError)throw Error('无法连接 MCP 服务，请检查地址和网络。');throw e;}
  finally{clearTimeout(timer);if(session)await fetch(endpoint,{method:'DELETE',headers:headers(),redirect:'error',signal:AbortSignal.timeout(2000)}).then(r=>r.body?.cancel()).catch(()=>{});}
}
export async function listMcpTools(rpc) {
  const all=[];let cursor;for(let n=0;n<20;n++){
    const result=await rpc('tools/list',cursor?{cursor}:{});if(!Array.isArray(result.tools))throw Error('MCP 工具清单无效。');all.push(...result.tools);cursor=result.nextCursor;if(!cursor)return all;
  }throw Error('MCP 工具清单分页过多。');
}
export function checkTool(tool,agent) {
  const schema=tool?.inputSchema;
  if(!schema||schema.type!=='object'||schema.properties?.[agent.inputKey]?.type!=='string')throw Error('请选择接收字符串提示词的 MCP 对话工具及输入字段。');
  for(const key of schema.required||[])if(key!==agent.inputKey&&!(key in agent.arguments))throw Error('工具还有必填参数，请在附加参数中填写：'+key);
}
export async function runProvider(agent,prompt,schema) {
  if(agent.kind==='codex')return runCodex(prompt,schema);
  return withMcp(agent,async rpc=>{
    const tool=(await listMcpTools(rpc)).find(t=>t.name===agent.tool);checkTool(tool,agent);
    const result=await rpc('tools/call',{name:agent.tool,arguments:{...agent.arguments,[agent.inputKey]:prompt}});
    if(result.isError)throw Error('MCP 智能体执行失败，请检查所选工具。');
    if(result.structuredContent?.type)return result.structuredContent;
    const text=(result.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n').trim().replace(/^```(?:json)?\s*\n?|\n?```$/g,'');
    try{return JSON.parse(text);}catch{throw Error('MCP 智能体未返回约定的问答 JSON。');}
  });
}
