const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('mambaDesktop',Object.freeze({chooseFolders:()=>ipcRenderer.invoke('choose-media-folders')}));
