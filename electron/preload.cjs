const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  setCloseToTray: (enabled) => ipcRenderer.invoke('app:set-close-to-tray', Boolean(enabled)),
  onCloseToTrayChange: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('app:close-to-tray', listener);
    return () => ipcRenderer.removeListener('app:close-to-tray', listener);
  },
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onMaximizedChange: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('window:maximized', listener);
    return () => ipcRenderer.removeListener('window:maximized', listener);
  },
  getSystemStats: () => ipcRenderer.invoke('system:stats'),
  loadState: () => ipcRenderer.invoke('state:load'),
  saveState: (state) => ipcRenderer.invoke('state:save', state),
  scanEngine: (root) => ipcRenderer.invoke('engine:scan', root),
  costSnapshot: (root) => ipcRenderer.invoke('cost:snapshot', root),
  engineStatus: () => ipcRenderer.invoke('engine:status'),
  engineStart: () => ipcRenderer.invoke('engine:start'),
  engineRestart: () => ipcRenderer.invoke('engine:restart'),
  onEngineStatus: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('engine:status', listener);
    return () => ipcRenderer.removeListener('engine:status', listener);
  },
  defaultPaths: () => ipcRenderer.invoke('paths:defaults'),
  pickEngineRoot: (defaultPath) => ipcRenderer.invoke('engine:pick-root', defaultPath),
  pickWorkspaceRoot: (defaultPath) => ipcRenderer.invoke('workspace:pick-root', defaultPath),
  pickDirectory: (title, defaultPath) =>
    ipcRenderer.invoke('path:pick-directory', { title, defaultPath }),
  listDirectory: (root, relative) => ipcRenderer.invoke('fs:list', { root, relative }),
  resolvePath: (root, target) => ipcRenderer.invoke('fs:resolve', { root, target }),
  previewFile: (root, relative) => ipcRenderer.invoke('fs:preview', { root, relative }),
  writeFile: (root, relative, text) => ipcRenderer.invoke('fs:write', { root, relative, text }),
  healthCheck: (engineSettings) => ipcRenderer.invoke('health:check', engineSettings),
  readEngineDoc: (root, relative) => ipcRenderer.invoke('engine:doc-read', { root, relative }),
  writeEngineDoc: (root, relative, text) =>
    ipcRenderer.invoke('engine:doc-write', { root, relative, text }),
  scanSkills: (root) => ipcRenderer.invoke('engine:skills', root),
  readSkillDoc: (root, id) => ipcRenderer.invoke('engine:skill-doc', { root, id }),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  terminalShells: () => ipcRenderer.invoke('terminal:shells'),
  terminalStart: (options) => ipcRenderer.invoke('terminal:start', options),
  terminalExec: (id, command) => ipcRenderer.invoke('terminal:exec', { id, command }),
  terminalKill: (id) => ipcRenderer.invoke('terminal:kill', { id }),
  onTerminalData: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('terminal:data', listener);
    return () => ipcRenderer.removeListener('terminal:data', listener);
  },
  onTerminalCwd: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('terminal:cwd', listener);
    return () => ipcRenderer.removeListener('terminal:cwd', listener);
  },
  onTerminalExit: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('terminal:exit', listener);
    return () => ipcRenderer.removeListener('terminal:exit', listener);
  },
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  openPath: (target) => ipcRenderer.invoke('shell:open-path', target),
  platform: process.platform,
});
