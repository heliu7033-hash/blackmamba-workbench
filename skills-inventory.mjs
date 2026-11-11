import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';

// Metadata only. No skill body, credentials, execution, or arbitrary-path endpoint.
const SKIP = new Set(['.git', 'node_modules', '__pycache__', 'assets', 'references', 'scripts', 'examples', 'tests']);
const inside = (p, root) => p === root || p.startsWith(root + path.sep);
function scalar(value) {
  const s = value.trim();
  if (s.startsWith('"') && s.endsWith('"')) { try { return JSON.parse(s); } catch {} }
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s.replace(/\s+#.*$/, '').trim();
}
export function metadata(text) {
  const match = text.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;
  const lines = match[1].split(/\r?\n/), out = {};
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(name|description):\s*(.*)$/);
    if (!m) continue;
    let value = m[2];
    if (/^[>|][-+]?\s*$/.test(value)) {
      const parts = [];
      while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || !lines[i + 1])) parts.push(lines[++i].trim());
      value = parts.join(' ');
    } else if ((/^['"]/.test(value) && !value.endsWith(value[0])) || !/^['"]/.test(value)) {
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) value += ' ' + lines[++i].trim();
    }
    out[m[1]] = scalar(value);
  }
  return typeof out.name === 'string' && out.name.trim() ? {name:out.name.slice(0,200), description:(out.description || '').slice(0,3000)} : null;
}
export function scanSkills({home = os.homedir()} = {}) {
  home = fs.realpathSync(home);
  const codex = path.join(home, '.codex'), shared = path.join(home, '.agents');
  const roots = [path.join(codex,'skills'), path.join(shared,'skills')];
  const allowed = [...roots,path.join(home,'.dsh','skills'),path.join(codex,'plugins','cache')];
  const entries = [], warnings = [], sources = [], seenFiles = new Set();
  const warning = (p,message) => warnings.push({path:p,message});
  const read = p => { const fd=fs.openSync(p,'r'); try { const b=Buffer.alloc(65536); return b.subarray(0,fs.readSync(fd,b,0,b.length,0)).toString('utf8'); } finally {fs.closeSync(fd);} };
  let lock = {};
  try {lock = JSON.parse(fs.readFileSync(path.join(shared,'.skill-lock.json'),'utf8')).skills || {};} catch (e) {if(e.code!=='ENOENT') warning(path.join(shared,'.skill-lock.json'),'安装来源记录无法读取');}
  const config = new Map();
  try {
    const text = fs.readFileSync(path.join(codex,'config.toml'),'utf8');
    for (const m of text.matchAll(/^\[plugins\."([^"]+)"\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/gm)) {
      const enabled=m[2].match(/^enabled\s*=\s*(true|false)\s*(?:#.*)?$/m);
      if(enabled) config.set(m[1],enabled[1]==='true');
    }
  } catch (e) {if(e.code!=='ENOENT') warning(path.join(codex,'config.toml'),'插件启用配置无法读取，仅展示磁盘证据');}
  function visit(dir, source, ancestors = new Set(), depth = 0) {
    if (depth>32) {warning(dir,'超过扫描深度，未继续读取');return;}
    let real;
    try {real=fs.realpathSync(dir);} catch {warning(dir,'目录或符号链接不可读取');return;}
    if(!allowed.some(root=>inside(real,root))) {warning(dir,'链接目标不在技能目录范围，已跳过');return;}
    if(ancestors.has(real)) {warning(dir,'检测到循环链接，已跳过');return;}
    const next=new Set(ancestors).add(real), skill=path.join(dir,'SKILL.md');
    if(fs.existsSync(skill) && !seenFiles.has(skill)) {
      seenFiles.add(skill);
      try {
        const actual=fs.realpathSync(skill);
        if(!allowed.some(root=>inside(actual,root))) throw Error('outside');
        const info=metadata(read(skill));
        if(!info) warning(skill,'缺少有效 name 元数据，未计入技能数量');
        else {
          const origin=lock[path.basename(dir)];
          const provenance=source.group==='shared' && origin ? {label:origin.source || '',url:/^https?:\/\//.test(origin.sourceUrl || '')?origin.sourceUrl:'',evidence:path.join(shared,'.skill-lock.json')} : null;
          entries.push({...info,id:createHash('sha256').update(skill).digest('hex').slice(0,16),path:skill,realPath:actual,source:source.label,group:source.group,state:source.state,plugin:source.plugin || '',version:source.version || '',provenance,modifiedAt:fs.statSync(skill).mtime.toISOString()});
        }
      } catch {warning(skill,'技能元数据无法读取');}
    }
    let children;try {children=fs.readdirSync(dir,{withFileTypes:true});} catch {warning(dir,'目录无法读取');return;}
    for(const child of children.sort((a,b)=>a.name.localeCompare(b.name))) {
      if(SKIP.has(child.name)||(child.name.startsWith('.')&&child.name!=='.system')) continue;
      if(child.isDirectory()||child.isSymbolicLink()) visit(path.join(dir,child.name),source,next,depth+1);
    }
  }
  for(const [index,root] of roots.entries()) {
    sources.push({path:root,label:index?'共享 Skills 目录':'Codex Skills 目录',exists:fs.existsSync(root)});
    if(fs.existsSync(root)) visit(root,{label:index?'共享 Skills':'Codex 本地',group:index?'shared':'codex',state:'installed'});
  }
  const cache=path.join(codex,'plugins','cache');
  sources.push({path:cache,label:'插件技能文件（按配置区分启用与缓存）',exists:fs.existsSync(cache)});
  function dirs(p) {try{return fs.readdirSync(p,{withFileTypes:true}).filter(x=>x.isDirectory()||x.isSymbolicLink()).map(x=>x.name);}catch{return [];}}
  const pluginReal = new Set();
  for(const market of dirs(cache)) for(const plugin of dirs(path.join(cache,market))) for(const version of dirs(path.join(cache,market,plugin))) {
    const base=path.join(cache,market,plugin,version), manifest=path.join(base,'.codex-plugin','plugin.json');
    if(!fs.existsSync(manifest)) continue;
    let j, actual;try {actual=fs.realpathSync(base);if(!inside(actual,cache)||pluginReal.has(actual))continue;j=JSON.parse(fs.readFileSync(manifest,'utf8'));pluginReal.add(actual);}catch{warning(manifest,'插件清单无法读取');continue;}
    if(!j.skills) continue;
    const declarations=Array.isArray(j.skills)?j.skills:[j.skills];
    for(const relative of declarations) {
      if(typeof relative!=='string') {warning(manifest,'未识别的技能路径声明');continue;}
      const folder=path.resolve(base,relative);
      if(!inside(folder,base)){warning(manifest,'技能路径超出插件目录，已跳过');continue;}
      const enabled=config.get(`${plugin}@${market}`);
      if(fs.existsSync(folder)) visit(folder,{label:`${j.name || plugin} · ${market}`,group:'plugin',state:enabled===true?'configured':enabled===false?'disabled':'cached',plugin:j.name || plugin,version:String(j.version || version)});
      else warning(folder,'插件声明的技能目录不存在');
    }
  }
  entries.sort((a,b)=>a.name.localeCompare(b.name)||a.path.localeCompare(b.path));
  const confirmed=entries.filter(e=>['installed','configured'].includes(e.state));
  return {scannedAt:new Date().toISOString(),scope:'本机 Codex、共享 Skills 及插件技能目录；不包含其他项目或云端会话技能。',execution:'仅展示安装文件及来源，不执行技能；插件配置启用不代表本工作台已接入，缓存不代表当前会话可调用。',sources,entries,warnings,summary:{installedEntries:confirmed.length,installedNames:new Set(confirmed.map(e=>e.name)).size,cachedEntries:entries.length-confirmed.length,allEntries:entries.length}};
}
