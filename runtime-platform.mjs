import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);

export function toolCandidates(name,{platform=process.platform,env=process.env,home=os.homedir(),execPath=process.execPath}={}) {
  const win=platform==='win32',p=win?path.win32:path.posix;
  const value=key=>Object.entries(env).find(([k])=>k.toLowerCase()===key.toLowerCase())?.[1];
  const aliases=name==='python3'&&win?['python.exe','python3.exe']:[name+(win?'.exe':'')];
  const configured=value('MAMBA_'+(name==='codex'?'CODEX_BIN':name.toUpperCase()));
  const dirs=[p.dirname(execPath),p.join(home,'.local','bin'),...(value('PATH')||'').split(win?';':':').filter(Boolean),...(!win?['/opt/homebrew/bin','/usr/local/bin','/usr/bin','/bin']:[])];
  const candidates=[configured,...dirs.flatMap(dir=>aliases.map(alias=>p.join(dir.replace(/^"|"$/g,''),alias)))];
  if(name==='codex'&&platform==='darwin')candidates.push('/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex');
  if(name==='chrome'){
    if(win)for(const root of [value('PROGRAMFILES'),value('PROGRAMFILES(X86)'),value('LOCALAPPDATA')].filter(Boolean))candidates.push(p.join(root,'Google','Chrome','Application','chrome.exe'),p.join(root,'Microsoft','Edge','Application','msedge.exe'));
    else if(platform==='darwin')candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    else candidates.push('/usr/bin/google-chrome','/usr/bin/chromium');
  }
  return [...new Set(candidates.filter(Boolean))];
}
export function findTool(name,options={}){return toolCandidates(name,options).find(file=>{try{return fs.statSync(file).isFile();}catch{return false;}});}
export function childEnvironment(extra={}){
  const env={...process.env},key=Object.keys(env).find(k=>k.toLowerCase()==='path')||'PATH';
  env[key]=[path.dirname(process.execPath),path.join(os.homedir(),'.local','bin'),env[key]||''].join(path.delimiter);
  return {...env,...extra};
}
export function codexCommand(){
  const binary=findTool('codex');if(binary&&!/\.(cmd|bat|js)$/i.test(binary))return {file:binary,args:[],env:childEnvironment()};
  const candidates=[process.env.MAMBA_CODEX_BIN,...[process.env.APPDATA&&path.join(process.env.APPDATA,'npm'),path.dirname(process.execPath)].filter(Boolean).map(root=>path.join(root,'node_modules','@openai','codex','bin','codex.js'))];
  if(binary&&/\.cmd$/i.test(binary))candidates.unshift(path.join(path.dirname(binary),'node_modules','@openai','codex','bin','codex.js'));
  const script=candidates.find(file=>file?.endsWith('.js')&&fs.existsSync(file));
  if(script)return {file:process.execPath,args:[script],env:childEnvironment(process.versions.electron?{ELECTRON_RUN_AS_NODE:'1'}:{})};
  throw Error('未找到 Codex CLI，请安装并登录，或设置 MAMBA_CODEX_BIN 指向 codex.exe / codex.js。');
}
export async function convertStoryboardImage(source,target){
  const ffmpeg=findTool('ffmpeg');
  if(ffmpeg){await execute(ffmpeg,['-nostdin','-v','error','-i',source,'-vf','scale=1440:-2:force_original_aspect_ratio=decrease','-frames:v','1','-q:v','2','-y',target],{timeout:60000,windowsHide:true});return;}
  if(process.platform==='darwin'){await execute('/usr/bin/sips',['-s','format','jpeg','-s','formatOptions','90','--resampleWidth','1440',source,'--out',target],{timeout:60000});return;}
  throw Error('分镜图片转换需要 FFmpeg，请加入 PATH 或设置 MAMBA_FFMPEG 后重启工作台。');
}
