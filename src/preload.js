const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getInfo: (url) => ipcRenderer.invoke('get-info', url),
  downloadTrack: (url, outputDir) => ipcRenderer.invoke('download-track', url, outputDir),
  downloadVideo: (url, outputDir) => ipcRenderer.invoke('download-video', url, outputDir),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getDownloadPath: () => ipcRenderer.invoke('get-download-path'),
  openFolder: (path) => ipcRenderer.invoke('open-folder', path),
  checkDependencies: () => ipcRenderer.invoke('check-dependencies'),
  onProgress: (callback) => {
    ipcRenderer.on('download-progress', (event, data) => callback(data));
  }
});
