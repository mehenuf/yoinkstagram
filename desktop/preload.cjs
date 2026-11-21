const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('archivist', {
  getState: () => ipcRenderer.invoke('archivist:get-state'),
  getJobLogs: (id) => ipcRenderer.invoke('archivist:get-job-logs', id),
  subscribe: (listener) => {
    if (typeof listener !== 'function') throw new TypeError('A state listener must be a function.');
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('archivist:state', handler);
    return () => ipcRenderer.removeListener('archivist:state', handler);
  },
  enqueue: (request) => ipcRenderer.invoke('archivist:enqueue', request),
  pauseQueue: (paused) => ipcRenderer.invoke('archivist:pause', paused),
  cancelJob: (id) => ipcRenderer.invoke('archivist:cancel', id),
  retryJob: (id) => ipcRenderer.invoke('archivist:retry', id),
  removeJob: (id) => ipcRenderer.invoke('archivist:remove', id),
  chooseDirectory: () => ipcRenderer.invoke('archivist:choose-directory'),
  chooseMetadata: () => ipcRenderer.invoke('archivist:choose-metadata'),
  openDirectory: (path) => ipcRenderer.invoke('archivist:open-directory', path),
  login: (username, password) => ipcRenderer.invoke('archivist:login', username, password),
  loginWithBrowser: () => ipcRenderer.invoke('archivist:login-with-browser'),
  loginWithGoogle: () => ipcRenderer.invoke('archivist:login-with-google'),
  twoFactor: (code) => ipcRenderer.invoke('archivist:two-factor', code),
  cancelAuth: () => ipcRenderer.invoke('archivist:cancel-auth'),
  logout: () => ipcRenderer.invoke('archivist:logout'),
  openInstagram: (url) => ipcRenderer.invoke('archivist:open-instagram', url),
  setSettings: (settings) => ipcRenderer.invoke('archivist:settings', settings),
});
