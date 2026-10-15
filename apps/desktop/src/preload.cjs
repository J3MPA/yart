// This file is plain CommonJS. A preload in a sandbox is not a module, and its
// types are not removed. Without the sandbox, the preload of the page would get
// Node itself.
const electron = require('electron')

electron.contextBridge.exposeInMainWorld('yart_desktop', {
  unseenChanged(count) {
    electron.ipcRenderer.send('unseen-changed', count)
  },
  notify(notice) {
    electron.ipcRenderer.send('notify', notice)
  },
  signIn() {
    electron.ipcRenderer.send('sign-in')
  },
})
