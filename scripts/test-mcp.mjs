import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'mamba-mcp-'));
const file = path.join(tmp,'tasks.sqlite');
const client = process.env.MAMBA_TEST_MCP_LAUNCHER;
const db = new DatabaseSync(file);
const rpc = (method,params={}) => ({jsonrpc:'2.0',id:1,method,params});
const init = rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'fixture',version:'1'}});
const ready = {jsonrpc:'2.0',method:'notifications/initialized'};
const call = (name,args) => rpc('tools/call',{name,arguments:args});
const list = args => call('list_task_progress',args);
const change = args => call('update_task_status',{id:'t00',revision:1,status:'进行中',request_id:'unit-test-request-0001',...args});
function session(messages, write=false) {
  const argv = [...(client ? [] : ['mcp/tasks.mjs']),'--db',file,'--project','日常管理'];
  if (write) argv.push('--allow-status-update');
  const p = spawnSync(client || process.execPath,argv,{input:messages.map(m=>typeof m==='string'?m:JSON.stringify(m)).join('\n')+'\n',encoding:'utf8',timeout:5000});
  assert.equal(p.status,0,p.stderr);
  return p.stdout.trim().split('\n').map(s=>JSON.parse(s));
}
try {
  db.exec(fs.readFileSync('drizzle/0000_groovy_starjammers.sql','utf8'));
  const insert = db.prepare('INSERT INTO tasks(id,owner,project,name,notes,result,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,1)');
  for (let i=0;i<28;i++) insert.run('t'+String(i).padStart(2,'0'),'local-owner','日常管理','测试','限本机','保留成果',i===27?'已归档':'待开始');
  insert.run('other','local-owner','广告创作','跨项目','保留','保留','待开始');
  insert.run('another','another-owner','日常管理','跨用户','保留','保留','待开始');
  const before=db.prepare('SELECT * FROM tasks ORDER BY id').all();
  const [bad,early,hello,discovery,one,two,noWrite,leak] = session(['{',rpc('tools/list'),init,ready,rpc('tools/list'),list({}),list({after:'t24'}),change({}),list({project:'广告创作'})]);
  assert.equal(bad.error.code,-32700); assert.equal(early.error.code,-32002);
  assert.equal(hello.result.protocolVersion,'2025-06-18');
  assert.deepEqual(discovery.result.tools.map(t=>t.name),['list_task_progress']);
  assert.equal(one.result.structuredContent.tasks.length,25); assert.equal(one.result.structuredContent.next_after,'t24');
  assert.deepEqual(Object.keys(one.result.structuredContent.tasks[0]).sort(),['id','name','revision','status']);
  assert.deepEqual(two.result.structuredContent.tasks.map(t=>t.id),['t25','t26','t27']);
  assert.equal(noWrite.error.code,-32602); assert.equal(leak.error.code,-32602);
  assert.deepEqual(db.prepare('SELECT * FROM tasks ORDER BY id').all(),before);
  const blocked=session([init,ready,change({id:'other'}),change({id:'another'}),change({id:'t27'}),change({revision:9}),change({status:'unknown'}),change({request_id:'short'}),change({result:'替换'}),call('delete_task',{id:'t00'})],true).slice(1);
  assert.ok(blocked.every(r=>r.error || r.result?.isError));
  assert.deepEqual(db.prepare('SELECT * FROM tasks ORDER BY id').all(),before);
  const [,tools,first]=session([init,ready,rpc('tools/list'),change({})],true);
  assert.equal(tools.result.tools.length,2); assert.equal(first.result.structuredContent.task.revision,2);
  const [,retry,reuse,stale] = session([init,ready,change({}),change({status:'已完成'}),change({request_id:'unit-test-request-0002',status:'已完成'})],true);
  assert.deepEqual(first.result,retry.result); assert.ok(reuse.result.isError && stale.result.isError);
  const after=db.prepare('SELECT * FROM tasks ORDER BY id').all();
  for (const [i,prev] of before.entries()) {
    if(prev.id==='t00'){
      assert.deepEqual({...after[i],status:prev.status,revision:prev.revision,last_request:prev.last_request,updated_at:prev.updated_at},{...prev});
      assert.equal(after[i].status,'进行中'); assert.equal(after[i].revision,2);
    } else assert.deepEqual(after[i],prev);
  }
  console.log('PASS: MCP stdio handshake, discovery, scoped paged summaries, read-only default, guarded update and retry across restart');
} finally { db.close(); fs.rmSync(tmp,{recursive:true,force:true}); }
