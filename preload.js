const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickInput: () => ipcRenderer.invoke('pick-input'),
  pickOutput: (defaultName) => ipcRenderer.invoke('pick-output', defaultName),
  probe: (filePath) => ipcRenderer.invoke('probe', filePath),
  exportSegments: (opts) => ipcRenderer.invoke('export-segments', opts),
  exportGif: (opts) => ipcRenderer.invoke('export-gif', opts),
  reveal: (filePath) => ipcRenderer.invoke('reveal', filePath),
  onProgress: (cb) => ipcRenderer.on('trim-progress', (event, pct) => cb(pct)),
  fitWindow: (height) => ipcRenderer.invoke('fit-window', height),
  newWindow: () => ipcRenderer.invoke('new-window'),
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateStatus: (cb) =>
    ipcRenderer.on('updates:status', (event, data) => cb(data)),
  // Fires when the app is launched with a media file (double-click / "Open
  // with") or when a second instance forwards one.
  onOpenFile: (cb) =>
    ipcRenderer.on('open-file', (event, filePath) => cb(filePath)),
  // Resolve a dropped File to its absolute path. Uses webUtils (the supported
  // API in current Electron) and falls back to the legacy File.path property.
  getPathForFile: (file) => {
    try {
      if (webUtils && typeof webUtils.getPathForFile === 'function') {
        return webUtils.getPathForFile(file);
      }
    } catch (_) {
      /* fall through to legacy */
    }
    return (file && file.path) || null;
  }
});
