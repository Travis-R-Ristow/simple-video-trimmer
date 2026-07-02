const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickInput: () => ipcRenderer.invoke('pick-input'),
  pickOutput: (defaultName) => ipcRenderer.invoke('pick-output', defaultName),
  probe: (filePath) => ipcRenderer.invoke('probe', filePath),
  trim: (opts) => ipcRenderer.invoke('trim', opts),
  exportSegments: (opts) => ipcRenderer.invoke('export-segments', opts),
  exportGif: (opts) => ipcRenderer.invoke('export-gif', opts),
  reveal: (filePath) => ipcRenderer.invoke('reveal', filePath),
  onProgress: (cb) => ipcRenderer.on('trim-progress', (event, pct) => cb(pct)),
  fitWindow: (height) => ipcRenderer.invoke('fit-window', height),
  newWindow: () => ipcRenderer.invoke('new-window')
});
