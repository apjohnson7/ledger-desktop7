const { contextBridge, ipcRenderer } = require("electron");

// Mirrors the same window.storage.get/set/delete/list interface the app
// already calls, so App.jsx needed zero changes.
contextBridge.exposeInMainWorld("storage", {
  get: (key, shared = false) => ipcRenderer.invoke("storage:get", key, shared),
  set: (key, value, shared = false) => ipcRenderer.invoke("storage:set", key, value, shared),
  delete: (key, shared = false) => ipcRenderer.invoke("storage:delete", key, shared),
  list: (prefix = "", shared = false) => ipcRenderer.invoke("storage:list", prefix, shared),
});
