const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getInfo: (url) => ipcRenderer.invoke('get-info', url),
  downloadTrack: (url, outputDir) => ipcRenderer.invoke('download-track', url, outputDir),
  downloadVideo: (url, outputDir, ipodFormat) => ipcRenderer.invoke('download-video', url, outputDir, ipodFormat),
  stopDownload: () => ipcRenderer.invoke('stop-download'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getDownloadPath: () => ipcRenderer.invoke('get-download-path'),
  openFolder: (path) => ipcRenderer.invoke('open-folder', path),
  openRootFolder: () => ipcRenderer.invoke('open-root-folder'),
  checkDependencies: () => ipcRenderer.invoke('check-dependencies'),
  checkIpod: () => ipcRenderer.invoke('check-ipod'),
  copyToIpod: (filePath, artist, title) => ipcRenderer.invoke('copy-to-ipod', filePath, artist, title),
  videoToIpod: (filePath, artist, title) => ipcRenderer.invoke('video-to-ipod', filePath, artist, title),
  onProgress: (callback) => {
    ipcRenderer.on('download-progress', (event, data) => callback(data));
  }
});
