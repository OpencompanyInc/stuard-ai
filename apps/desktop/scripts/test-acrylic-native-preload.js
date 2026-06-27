const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("testAPI", {
  setMaterial: (material) => ipcRenderer.invoke("set-material", material),
});
