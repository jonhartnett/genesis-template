import {contextBridge, ipcRenderer} from 'electron';

//allow the renderer to access the invoke method from ipc
contextBridge.exposeInMainWorld('ipcRenderer', {
    invoke: ::ipcRenderer.invoke
});
