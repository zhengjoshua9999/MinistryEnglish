// 渲染进程通过 window.ministry 与主进程通信。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ministry', {
  // 首次启动时，主进程会推送安装进度文案。
  onSetupProgress: (callback) => {
    ipcRenderer.on('setup-progress', (_event, message) => callback(message));
  },
});
