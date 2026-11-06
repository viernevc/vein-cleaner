import { app, BrowserWindow, Menu } from 'electron'
import path from 'node:path'
import { IPC } from '@shared/ipc'

export function createMainWindow(initialTheme: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1080,
    minHeight: 680,
    frame: false,
    show: false,
    backgroundColor: initialTheme === 'green' ? '#e9f2e4' : '#f3f6fb',
    title: 'Vein 磁盘清理',
    autoHideMenuBar: true,
    icon: app.isPackaged ? undefined : path.join(app.getAppPath(), 'resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      additionalArguments: [`--vein-theme=${initialTheme}`]
    }
  })

  Menu.setApplicationMenu(null)

  win.once('ready-to-show', () => win.show())
  win.on('maximize', () => {
    if (!win.isDestroyed()) win.webContents.send(IPC.winMaximized, true)
  })
  win.on('unmaximize', () => {
    if (!win.isDestroyed()) win.webContents.send(IPC.winMaximized, false)
  })

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
  })
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())

  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        win.webContents.toggleDevTools()
      }
    })
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}
