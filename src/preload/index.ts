import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { TaskEvent, VeinApi } from '@shared/types'

const themeArg = process.argv.find((arg) => arg.startsWith('--vein-theme='))
const initialTheme = themeArg ? themeArg.split('=')[1] : 'light'

const api: VeinApi = {
  initialTheme,
  app: {
    state: () => ipcRenderer.invoke(IPC.appState),
    relaunchElevated: (payload) => ipcRenderer.invoke(IPC.appRelaunchElevated, payload),
    resumeAck: (payload) => ipcRenderer.invoke(IPC.appResumeAck, payload),
    showItem: (payload) => ipcRenderer.invoke(IPC.appShowItem, payload),
    openExternal: (payload) => ipcRenderer.invoke(IPC.appOpenExternal, payload)
  },
  rules: {
    list: () => ipcRenderer.invoke(IPC.rulesList)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (payload) => ipcRenderer.invoke(IPC.settingsUpdate, payload),
    setLogDir: (payload) => ipcRenderer.invoke(IPC.settingsSetLogDir, payload)
  },
  clean: {
    scan: (payload) => ipcRenderer.invoke(IPC.cleanScan, payload),
    run: (payload) => ipcRenderer.invoke(IPC.cleanRun, payload),
    entries: (payload) => ipcRenderer.invoke(IPC.cleanEntries, payload),
    report: (payload) => ipcRenderer.invoke(IPC.cleanReport, payload)
  },
  analyze: {
    drives: () => ipcRenderer.invoke(IPC.analyzeDrives),
    scan: (payload) => ipcRenderer.invoke(IPC.analyzeScan, payload),
    children: (payload) => ipcRenderer.invoke(IPC.analyzeChildren, payload),
    treemap: (payload) => ipcRenderer.invoke(IPC.analyzeTreemap, payload),
    topFiles: (payload) => ipcRenderer.invoke(IPC.analyzeTopFiles, payload)
  },
  duplicates: {
    scan: (payload) => ipcRenderer.invoke(IPC.dupScan, payload),
    groups: (payload) => ipcRenderer.invoke(IPC.dupGroups, payload),
    group: (payload) => ipcRenderer.invoke(IPC.dupGroup, payload),
    remove: (payload) => ipcRenderer.invoke(IPC.dupRemove, payload)
  },
  tasks: {
    cancel: (payload) => ipcRenderer.invoke(IPC.taskCancel, payload),
    snapshot: () => ipcRenderer.invoke(IPC.taskSnapshot),
    onEvent: (cb: (event: TaskEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, taskEvent: TaskEvent): void => cb(taskEvent)
      ipcRenderer.on(IPC.taskEvent, listener)
      return () => {
        ipcRenderer.off(IPC.taskEvent, listener)
      }
    }
  },
  window: {
    control: (action) => ipcRenderer.invoke(IPC.winControl, { action }),
    onMaximized: (cb: (maximized: boolean) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, value: boolean): void => cb(value)
      ipcRenderer.on(IPC.winMaximized, listener)
      return () => {
        ipcRenderer.off(IPC.winMaximized, listener)
      }
    }
  },
  dialog: {
    pickFolder: (payload) => ipcRenderer.invoke(IPC.dialogPickFolder, payload ?? {})
  }
}

contextBridge.exposeInMainWorld('vein', api)
