import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  platform: process.platform,
});
