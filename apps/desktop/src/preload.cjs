// Plain CommonJS because a sandboxed preload is neither a module nor stripped of
// types, and turning the sandbox off would hand the page's preload Node itself.
const electron = require('electron')

electron.contextBridge.exposeInMainWorld('yart_desktop', {
  unseenChanged(count) {
    electron.ipcRenderer.send('unseen-changed', count)
  },
  notify(notice) {
    electron.ipcRenderer.send('notify', notice)
  },
})
