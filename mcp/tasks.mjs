// Local MCP transport: one UTF-8 JSON-RPC message per line on stdin/stdout.
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const statuses = ['进行中', '等待确认', '已完成'];
const version = '2025-06-18';
const properties = {
  id: { type: 'string', minLength: 1, maxLength: 120 },
  revision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER - 1 },
  status: { type: 'string', enum: statuses },
  request_id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{16,100}$' },
};
const tool = (name, description, fields, required, readOnlyHint) => ({
  name, description,
  inputSchema: { type: 'object', properties: fields, required, additionalProperties: false },
  annotations: { readOnlyHint, destructiveHint: !readOnlyHint, idempotentHint: true, openWorldHint: false },
});
const list = tool('list_task_progress', '读取启动时指定项目的任务摘要，每页最多 25 条。next_after 可用于下一页。', {after: properties.id}, [], true);
const update = tool('update_task_status', '按已确认的修改更新一条任务状态。先读取 revision；重试使用相同 request_id。', properties, Object.keys(properties), false);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validID = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 120;
const summary = 'id, name, status, revision';
const scope = "owner = 'local-owner' AND project = ?";
class InputError extends Error {}

function serve(db, project, writable) {
  db.exec('PRAGMA busy_timeout = 2000');
  const page = db.prepare(`SELECT ${summary} FROM tasks WHERE ${scope} AND id > ? ORDER BY id LIMIT 26`);
  const lookup = db.prepare(`SELECT ${summary}, last_request FROM tasks WHERE ${scope} AND id = ?`);
  const mutate = writable && db.prepare(`UPDATE tasks SET status=?, revision=revision+1, updated_at=?, last_request=?
    WHERE ${scope} AND id=? AND revision=? AND status <> '已归档'`);
  function change(args) {
    const {id, status, revision, request_id} = args;
    if (!validID(id) || !statuses.includes(status) || !Number.isSafeInteger(revision) || revision < 1 ||
        revision >= Number.MAX_SAFE_INTEGER || typeof request_id !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(request_id))
      throw new InputError('状态更新参数无效');
    const marker = 'mcp:' + request_id;
    db.exec('BEGIN IMMEDIATE');
    try {
      const previous = lookup.get(project, id);
      if (!previous) throw new InputError('该项目中没有此任务');
      if (previous.last_request === marker) {
        if (previous.revision !== revision + 1 || previous.status !== status)
          throw new InputError('重复请求参数不一致');
      } else {
        if (previous.status === status) throw new InputError('已是目标状态');
        if (!mutate.run(status, Date.now(), marker, project, id, revision).changes)
          throw new InputError('任务已归档或版本已变更，请重新读取');
      }
      const {last_request, ...task} = lookup.get(project, id);
      db.exec('COMMIT');
      return {project, task};
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  const tools = writable ? [list, update] : [list];
  let phase = 'new';
  return function handle(msg) {
    const error = (code, message) => ({jsonrpc:'2.0', id:msg?.id ?? null, error:{code, message}});
    if (!object(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string' ||
        ('id' in msg && typeof msg.id !== 'string' && !Number.isSafeInteger(msg.id)))
      return error(-32600, 'Invalid Request');
    if (!('id' in msg)) {
      if (msg.method === 'notifications/initialized' && phase === 'initializing') phase = 'ready';
      return;
    }
    const result = value => ({jsonrpc:'2.0', id:msg.id, result:value});
    if (msg.method === 'ping') return result({});
    if (msg.method === 'initialize' && phase === 'new') {
      if (typeof msg.params?.protocolVersion !== 'string' || !object(msg.params?.clientInfo) || !object(msg.params?.capabilities))
        return error(-32602, 'Invalid initialize parameters');
      phase = 'initializing';
      return result({protocolVersion:version, capabilities:{tools:{}}, serverInfo:{name:'blackmamba-local-progress',version:'1.0.0'}});
    }
    if (phase !== 'ready') return error(-32002, 'Server not initialized');
    if (msg.method === 'tools/list') return result({tools});
    if (msg.method !== 'tools/call') return error(-32601, 'Method not found');
    const selected = tools.find(t => t.name === msg.params?.name);
    if (!selected) return error(-32602, 'Unknown tool');
    const args = msg.params.arguments === undefined ? {} : msg.params.arguments;
    if (!object(args) || Object.keys(args).some(key => !Object.hasOwn(selected.inputSchema.properties, key)))
      return error(-32602, 'Unexpected arguments');
    try {
      let data;
      if (selected === list) {
        if ('after' in args && !validID(args.after)) throw new InputError('无效游标');
        const rows = page.all(project, args.after ?? '');
        data = {project, tasks:rows.slice(0,25), next_after:rows.length > 25 ? rows[24].id : null};
      } else data = change(args);
      return result({content:[{type:'text',text:JSON.stringify(data)}], structuredContent:data});
    } catch (e) {
      return result({isError:true,content:[{type:'text',text:e instanceof InputError ? e.message : '数据库暂不可用，请重新读取状态'}]});
    }
  };
}

async function main() {
  const {values} = parseArgs({options:{project:{type:'string'},db:{type:'string'},'allow-status-update':{type:'boolean',default:false}}});
  if (!values.project?.trim() || values.project.length > 100) throw new Error('请用 --project 指定一个项目分区');
  const path = realpathSync(values.db ?? fileURLToPath(new URL('../data/tasks.sqlite', import.meta.url)));
  const db = new DatabaseSync(path, {readOnly: !values['allow-status-update'], allowExtension:false});
  try {
    const handle = serve(db, values.project, values['allow-status-update']);
    let partial = Buffer.alloc(0);
    for await (const chunk of process.stdin) {
      let start = 0;
      while (start < chunk.length) {
        const end = chunk.indexOf(10, start);
        const segment = chunk.subarray(start, end < 0 ? chunk.length : end);
        if (partial.length + segment.length > 65536) throw new Error('MCP 输入行超过 64 KiB');
        partial = Buffer.concat([partial, segment]);
        if (end < 0) break;
        let msg, reply;
        try { msg = JSON.parse(partial.toString('utf8')); }
        catch { reply = {jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}}; }
        reply ??= handle(msg);
        if (reply) await new Promise((resolve,reject) => process.stdout.write(JSON.stringify(reply)+'\n', e => e ? reject(e) : resolve()));
        partial = Buffer.alloc(0);
        start = end + 1;
      }
    }
  } finally { db.close(); }
}
main().catch(e => { console.error(e.code === 'ENOENT' ? '找不到已有任务数据库' : e.message); process.exitCode = 1; });
