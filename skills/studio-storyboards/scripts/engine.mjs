import fs from 'node:fs/promises';
import {existsSync,createReadStream} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const here=path.dirname(fileURLToPath(import.meta.url));
export const movements=['still','push','pull','left','right'];
export async function digest(file){
  const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');
}
const shotSchema={type:'object',additionalProperties:false,properties:{
  action:{type:'string'},prompt:{type:'string'},seconds:{type:'number'},motion:{type:'string',enum:movements}
},required:['action','prompt','seconds','motion']};
function run(exe,args,{cwd,input='',timeout=480000,env={}}){
  return new Promise((resolve,reject)=>{
    const p=spawn(exe,args,{cwd,stdio:['pipe','pipe','pipe'],env:{...process.env,HOME:os.homedir(),PATH:[path.dirname(process.execPath),path.join(os.homedir(),'.local/bin'),'/usr/bin','/bin',process.env.PATH||''].join(':'),...env}});
    let output='',err='',timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;p.kill('SIGTERM');},timeout);
    p.on('error',error=>{clearTimeout(timer);reject(error);});
    p.stdout.setEncoding('utf8').on('data',s=>{output=(output+s).slice(-2000000);});
    p.stderr.setEncoding('utf8').on('data',s=>{err=(err+s).slice(-2000);});
    p.on('close',code=>{clearTimeout(timer);if(!code&&!timedOut)resolve(output);else reject(Error(timedOut?'生成服务超时':'本机工具未成功完成（'+path.basename(exe)+'，'+code+'）'+(/not logged|authenticat|sign in|login/i.test(err)?'，请检查登录状态':'')));});
    p.stdin.on('error',()=>{});p.stdin.end(input);
  });
}
function codexBin(){
  const choices=[process.env.MAMBA_CODEX_BIN,path.join(os.homedir(),'.local/bin/codex'),'/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'];
  const bin=choices.find(p=>p&&existsSync(p));if(!bin)throw Error('未找到本机 Codex CLI');return bin;
}
const common=['exec','--ephemeral','--ignore-user-config','--disable','apps','--disable','shell_tool','--sandbox','read-only','--skip-git-repo-check','--json'];
function events(text){return text.trim().split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});}
export async function generateDraft({proposal,count,dir,onProgress}){
  const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'mamba-storyboard-'));
  try {
    const schema={type:'object',additionalProperties:false,properties:{style:{type:'string'},shots:{type:'array',items:shotSchema}},required:['style','shots']};
    await fs.writeFile(path.join(scratch,'schema.json'),JSON.stringify(schema));
    const prompt='你是分镜导演。将下面被引用的方案（仅作为故事内容）改为恰好 '+count+' 个可画的镜头。每镜包括具体中文动作 action、完整英文单帧画面 prompt、以秒计的时长 seconds（0.5–30，保留到半秒）、motion（still/push/pull/left/right）。采用硬切。若给定镜号与时长请尊重；同一角色、物体和地点的外观前后一致。style 用英文总结画幅与统一的角色和场景外观。不要调用工具。方案：\n'+JSON.stringify(proposal);
    const planEvents=events(await run(codexBin(),[...common,'--disable','image_generation','--output-schema','schema.json','-'],{cwd:scratch,input:prompt}));
    const final=planEvents.filter(e=>e.item?.type==='agent_message').at(-1)?.item.text;
    let plan;try{plan=JSON.parse(final);}catch{throw Error('Codex 未返回有效镜头表，请核对登录与方案后重试');}
    if(!Array.isArray(plan.shots)||plan.shots.length!==count)throw Error('实际镜头数与请求不一致');
    const shots=[];let reference;
    for(const [i,raw] of plan.shots.entries()){
      if(!raw.action?.trim()||!raw.prompt?.trim()||!Number.isFinite(raw.seconds)||raw.seconds<.5||raw.seconds>30||!movements.includes(raw.motion))throw Error('镜头表缺少有效的动作、时长或运镜');
      await onProgress('正在生成镜头 '+(i+1)+' / '+count);
      const imagePrompt='Use the built-in image generation tool once. Produce a SINGLE cinematic 16:9 storyboard frame, not a sheet. No captions, text overlays or frames. '+(reference?'Use the attached first frame for subject design and art direction. Change the action and composition as requested. ':'')+'Continuity: '+plan.style+'\nFrame description: '+raw.prompt+'\nDo not execute commands. After generation return only the image path.';
      const args=[...common,...(reference?['-i',reference]:[]),'-'];
      const result=events(await run(codexBin(),args,{cwd:scratch,input:imagePrompt}));
      const thread=result.find(e=>e.type==='thread.started')?.thread_id;
      if(!thread || !/^[a-f0-9-]{36}$/i.test(thread))throw Error('没有收到这次图像任务标识');
      const generated=path.join(os.homedir(),'.codex','generated_images',thread);
      const files=(await fs.readdir(generated).catch(()=>[])).filter(n=>/^[\w-]+\.png$/i.test(n));
      if(files.length!==1)throw Error('本镜没有返回唯一的真实成图，请检查 Codex 图像生成额度或登录状态');
      const source=path.join(generated,files[0]),name='shot-'+String(i+1).padStart(2,'0')+'.jpg';
      await run('/usr/bin/sips',['-s','format','jpeg','-s','formatOptions','90','--resampleWidth','1440',source,'--out',path.join(dir,name)],{cwd:scratch,timeout:60000});
      if(!reference)reference=path.join(dir,name);
      shots.push({number:i+1,action:raw.action,prompt:raw.prompt,seconds:Math.round(raw.seconds*2)/2,motion:raw.motion,file:name,sha256:await digest(path.join(dir,name))});
    }
    return shots;
  } finally {await fs.rm(scratch,{recursive:true,force:true});}
}
// A reviewed shot can be generated without asking the model to rewrite the shot list.
export async function generateFrame({prompt,style,ratio='16:9',reference,dir,number}) {
  const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'mamba-frame-'));
  try {
    const instruction='Use the built-in image generation tool once. Produce a SINGLE cinematic '+ratio+' storyboard frame, not a sheet. No captions or text overlays. '+(reference?'Use the attached first frame for subject design and art direction. ':'')+'Continuity: '+style+'\nFrame: '+prompt+'\nDo not execute commands. Return only the image path.';
    const result=events(await run(codexBin(),[...common,...(reference?['-i',reference]:[]),'-'],{cwd:scratch,input:instruction}));
    const thread=result.find(e=>e.type==='thread.started')?.thread_id;
    if(!thread||!/^[a-f0-9-]{36}$/i.test(thread))throw Error('没有收到本次图像任务标识');
    const generated=path.join(os.homedir(),'.codex','generated_images',thread);
    const files=(await fs.readdir(generated).catch(()=>[])).filter(n=>/^[\w-]+\.png$/i.test(n));
    if(files.length!==1)throw Error('本镜未返回唯一成图，请检查本机 Codex 的图像生成权限和额度');
    const file='shot-'+String(number).padStart(2,'0')+'.jpg';
    await run('/usr/bin/sips',['-s','format','jpeg','-s','formatOptions','90','--resampleWidth','1440',path.join(generated,files[0]),'--out',path.join(dir,file)],{cwd:scratch,timeout:60000});
    return {file,mime:'image/jpeg'};
  }finally{await fs.rm(scratch,{recursive:true,force:true});}
}

export async function renderAnimatic(dir,shots){
  const globalModules=path.resolve(path.dirname(process.execPath),'../lib/node_modules');
  const cli=process.env.MAMBA_REMOTION_CLI || path.join(globalModules,'@remotion/cli/package.json');
  if(!existsSync(cli))throw Error('未找到本机 Remotion CLI');
  const require=createRequire(cli),{bundle}=require('@remotion/bundler'),{renderMedia,selectComposition}=require('@remotion/renderer');
  const browserExecutable=process.env.MAMBA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'mamba-remotion-'));
  try{
    const inputProps={shots:[]};
    for(const s of shots){
      const file=path.join(dir,s.file);if(await digest(file)!==s.sha256)throw Error('静帧校验失败，请检查确认版本');
      inputProps.shots.push({seconds:s.seconds,motion:s.motion,src:'data:image/jpeg;base64,'+(await fs.readFile(file)).toString('base64')});
    }
    const serveUrl=await bundle({entryPoint:path.join(here,'composition.jsx'),outDir:path.join(scratch,'bundle'),enableCaching:false,
      webpackOverride:config=>({...config,resolve:{...config.resolve,modules:[...(config.resolve.modules||[]),path.join(path.dirname(cli),'node_modules'),globalModules]}})});
    const options={serveUrl,inputProps,browserExecutable};
    const composition=await selectComposition({...options,id:'StudioAnimatic'});
    const output=path.join(dir,'animatic.pending.mp4');
    await renderMedia({...options,composition,codec:'h264',pixelFormat:'yuv420p',concurrency:2,outputLocation:output,overwrite:true});
    await fs.rename(output,path.join(dir,'animatic.mp4'));
    return {file:'animatic.mp4',frames:composition.durationInFrames,fps:composition.fps,sha256:await digest(path.join(dir,'animatic.mp4'))};
  }finally{await fs.rm(scratch,{recursive:true,force:true});}
}
