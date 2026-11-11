const {app,BrowserWindow,Menu,dialog,ipcMain,shell,utilityProcess}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const smoke=process.argv.includes('--smoke-write')?'write':process.argv.includes('--smoke-read')?'read':null;
if(smoke){
  if(!process.env.MAMBA_DESKTOP_TEST_DIR)throw Error('Smoke test requires an isolated directory');
  app.setPath('userData',path.join(process.env.MAMBA_DESKTOP_TEST_DIR,'profile'));
}
const root=path.resolve(__dirname,'../..');
const port=smoke?18779:18771,origin='http://127.0.0.1:'+port,instance=randomUUID();
let main,service,exiting=false,data;
function local(url){try{return new URL(url).origin===origin;}catch{return false;}}
function external(url){try{const u=new URL(url);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}}
function stop(){if(service){service.kill();service=null;}}
async function showDocument(url){
  try{
    const id=decodeURIComponent(new URL(url).pathname.slice('/local-document/'.length));
    const index=JSON.parse(fs.readFileSync(path.join(data,'local-library','open.json'),'utf8'));
    if(!Object.hasOwn(index.paths,id))throw Error('Missing document');
    const base=fs.realpathSync(index.root),file=fs.realpathSync(path.resolve(base,index.paths[id]));
    const relative=path.relative(base,file);
    if(relative.startsWith('..')||path.isAbsolute(relative)||path.extname(file).toLowerCase()!=='.md'||fs.statSync(file).size>2e6)throw Error('Invalid document');
    const text=fs.readFileSync(file,'utf8').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
    const reader=new BrowserWindow({parent:main,width:860,height:700,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
    reader.webContents.setWindowOpenHandler(()=>({action:'deny'}));reader.webContents.on('will-navigate',e=>e.preventDefault());
    await reader.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;"><title>本地资料</title><pre style="white-space:pre-wrap;padding:24px;font:16px/1.7 sans-serif">'+text+'</pre>'));
  }catch{await dialog.showMessageBox(main,{type:'info',message:'资料原文不可用，请检查本机资料目录。'});}
}
function navigation(event,url){
  if(local(url)&&!new URL(url).pathname.startsWith('/local-document/'))return;
  event.preventDefault();
  if(local(url))void showDocument(url);
  else if(external(url))void shell.openExternal(url);
}
async function start(){
  data=path.join(smoke?process.env.MAMBA_DESKTOP_TEST_DIR:app.getPath('userData'),'workspace');
  fs.mkdirSync(data,{recursive:true});
  service=utilityProcess.fork(path.join(root,'server.mjs'),[],{cwd:root,env:{...process.env,MAMBA_DATA_DIR:data,MAMBA_PORT:String(port),MAMBA_INSTANCE:instance},stdio:'pipe',serviceName:'Black Mamba local service'});
  let failed=false,serviceError='';
  service.stdout?.on('data',()=>{});service.stderr?.on('data',chunk=>{serviceError=(serviceError+chunk.toString()).slice(-4000);});
  service.on('exit',()=>{failed=true;if(main&&!exiting){dialog.showErrorBox('本机服务已停止','请退出工作台后重新打开，项目数据保留。');app.quit();}});
  let ready=false;
  for(let i=0;i<150&&!failed;i++){
    try{const r=await fetch(origin+'/health',{signal:AbortSignal.timeout(800)}),v=await r.json();if(v.instance===instance){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  if(!ready)throw Error('本机服务未能启动。请关闭其他工作台实例并确认端口 18771 未被占用。'+(smoke?serviceError:''));
  main=new BrowserWindow({width:1220,height:850,minWidth:650,minHeight:600,backgroundColor:'#0a0a0a',title:'黑曼巴工作台',webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  const ses=main.webContents.session;
  ses.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  ses.setPermissionCheckHandler(()=>false);
  ses.on('will-download',(_event,item)=>{item.setSaveDialogOptions({defaultPath:path.join(app.getPath('downloads'),path.basename(item.getFilename()))});});
  main.webContents.on('will-navigate',navigation);
  main.webContents.on('will-redirect',navigation);
  main.webContents.setWindowOpenHandler(({url})=>{if(local(url)&&new URL(url).pathname.startsWith('/local-document/'))void showDocument(url);else if(external(url)&&!local(url))void shell.openExternal(url);return {action:'deny'};});
  ipcMain.handle('choose-media-folders',async event=>{
    if(event.sender!==main.webContents||event.senderFrame!==main.webContents.mainFrame||!local(event.senderFrame.url))throw Error('Invalid sender');
    const result=await dialog.showOpenDialog(main,{title:'选择素材文件夹',properties:['openDirectory','multiSelections']});
    return result.canceled?[]:result.filePaths;
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'工作台',submenu:[{label:'打开数据目录',click:()=>shell.openPath(data)},{type:'separator'},{label:'退出',accelerator:'Alt+F4',click:()=>app.quit()}]},
    {label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    {label:'窗口',submenu:[{role:'reload'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]}
  ]));
  await main.loadURL(origin,{userAgent:main.webContents.getUserAgent()+' MambaDesktop'});
  if(smoke){
    try{
      const result=await require('./smoke.cjs').run(main,smoke);
      fs.writeFileSync(path.join(process.env.MAMBA_DESKTOP_TEST_DIR,smoke+'.json'),JSON.stringify({...result,electron:process.versions.electron,node:process.versions.node}));
      await ses.flushStorageData();app.quit();
    }catch(e){fs.writeFileSync(path.join(process.env.MAMBA_DESKTOP_TEST_DIR,'error.txt'),e.stack);exiting=true;stop();app.exit(1);}
  }
}
if(!app.requestSingleInstanceLock())app.quit();
else{
  app.on('second-instance',()=>{if(main){if(main.isMinimized())main.restore();main.show();main.focus();}});
  app.whenReady().then(()=>{app.setAppUserModelId('studio.blackmamba.workbench');return start();}).catch(e=>{if(smoke)fs.writeFileSync(path.join(process.env.MAMBA_DESKTOP_TEST_DIR,'error.txt'),e.stack);else dialog.showErrorBox('工作台启动失败',e.message);exiting=true;stop();app.exit(1);});
}
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{exiting=true;stop();});
