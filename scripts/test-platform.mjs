import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {toolCandidates,codexCommand,childEnvironment,findTool,convertStoryboardImage} from '../runtime-platform.mjs';
import {runCodex} from '../creative-providers.mjs';
const opts={platform:'win32',home:'C:\\Users\\Test User',execPath:'C:\\App\\Workbench.exe',env:{Path:'C:\\Tools With Spaces;D:\\媒体工具',APPDATA:'C:\\Users\\Test User\\AppData\\Roaming',PROGRAMFILES:'C:\\Program Files'}};
assert(toolCandidates('ffmpeg',opts).includes('D:\\媒体工具\\ffmpeg.exe'));
assert(toolCandidates('python3',opts).includes('C:\\Tools With Spaces\\python.exe'));
assert(toolCandidates('chrome',opts).includes('C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'));
assert.equal(toolCandidates('codex',{...opts,env:{MAMBA_CODEX_BIN:'D:\\工具\\codex.exe'}})[0],'D:\\工具\\codex.exe');
assert(!toolCandidates('ffmpeg',opts).some(p=>p.includes('/usr/')));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mamba tools 中文 & ')),old=process.env.MAMBA_CODEX_BIN;
try{
  const script=path.join(dir,'fake codex.js');
  fs.writeFileSync(script,'process.stdin.resume();process.stdin.on("end",()=>console.log(JSON.stringify({item:{type:"agent_message",text:JSON.stringify({ok:true})}})));');
  process.env.MAMBA_CODEX_BIN=script;
  assert.equal(codexCommand().args[0],script);
  assert.deepEqual(await runCodex('only a synthetic test',{type:'object'}),{ok:true});
  assert(childEnvironment().PATH||childEnvironment().Path);
  const ffmpeg=findTool('ffmpeg');assert(ffmpeg,'FFmpeg required for cross-platform image conversion test');
  const source=path.join(dir,'源图片.png'),target=path.join(dir,'分镜图.jpg');
  execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','color=c=blue:s=32x24','-frames:v','1',source]);
  await convertStoryboardImage(source,target);assert.equal(fs.readFileSync(target).subarray(0,2).toString('hex'),'ffd8');
}finally{if(old===undefined)delete process.env.MAMBA_CODEX_BIN;else process.env.MAMBA_CODEX_BIN=old;fs.rmSync(dir,{recursive:true,force:true});}
console.log('PASS platform paths, Windows tools, Unicode/spaces, shell-free Codex shim, preserved PATH and real image conversion');
