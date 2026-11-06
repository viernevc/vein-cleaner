import { app, BrowserWindow, nativeTheme } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { IPC } from '@shared/ipc'
import { initLogger, log, resolveLogsDir } from './core/logger'
import { getSettings, nativeThemeSource } from './core/settings'
import { setResumeTask } from './core/app-state'
import { tasks } from './core/task-manager'
import { registerIpc } from './ipc'
import { setTrustedWebContents } from './ipc/guard'
import { clearPending, consumeResumeFromArgv } from './platform/elevation'
import { recoverJournalOnStartup } from './platform/services'
import { createMainWindow } from './window'

app.enableSandbox()

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null

app.whenReady().then(async () => {
  const userData = app.getPath('userData')
  const settings = getSettings()
  const logsDir = resolveLogsDir(userData, settings.logDir)
  initLogger(logsDir)
  log('info', '应用启动', {
    version: app.getVersion(),
    elevated: process.argv.includes('--elevated'),
    logsDir
  })
  if (
    settings.logDir &&
    path.win32.resolve(settings.logDir).toLowerCase() !== path.win32.resolve(logsDir).toLowerCase()
  ) {
    log('warn', '自定义日志目录不可写，已回退到默认目录', {
      requested: settings.logDir,
      actual: logsDir
    })
  }

  nativeTheme.themeSource = nativeThemeSource(settings.theme)

  const resume = consumeResumeFromArgv(process.argv)
  if (resume) {
    setResumeTask(resume)
    log('info', '已加载提权续跑任务', { ruleIds: resume.ruleIds })
  } else if (process.argv.includes('--elevated')) {
    clearPending()
  }

  await recoverJournalOnStartup(userData)

  app.setAppUserModelId('com.vein.diskcleaner')

  registerIpc(() => mainWindow)
  tasks.setSink((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.taskEvent, event)
    }
  })

  mainWindow = createMainWindow(settings.theme)
  setTrustedWebContents(mainWindow.webContents.id)

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 仅开发环境：VEIN_CAPTURE=1 时自动逐页截图，便于回归检查界面
  if (!app.isPackaged && process.env.VEIN_CAPTURE) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void (async () => {
          try {
            for (const route of ['dashboard', 'clean', 'analyze', 'duplicates', 'settings']) {
              await mainWindow?.webContents.executeJavaScript(`location.hash = '#/${route}'`)
              if (route === 'dashboard') {
                for (let i = 0; i < 20; i++) {
                  const ready = await mainWindow?.webContents.executeJavaScript(
                    `!!document.querySelector('.drive-card')`
                  )
                  if (ready) break
                  await new Promise((resolve) => setTimeout(resolve, 300))
                }
                for (let i = 0; i < 10; i++) {
                  const labeled = await mainWindow?.webContents.executeJavaScript(
                    `[...document.querySelectorAll('.drive-card__volume')].some((el) => {
                      const text = (el.textContent || '').trim()
                      return !!text && text !== '本地磁盘'
                    })`
                  )
                  if (labeled) break
                  await new Promise((resolve) => setTimeout(resolve, 300))
                }
              } else {
                await new Promise((resolve) => setTimeout(resolve, 1000))
              }
              const image = await mainWindow?.webContents.capturePage()
              if (image) {
                fs.writeFileSync(path.join(process.cwd(), `capture-${route}.png`), image.toPNG())
              }
            }

            if (process.env.VEIN_CAPTURE_SCAN) {
              const sleep = (ms: number): Promise<void> =>
                new Promise((resolve) => setTimeout(resolve, ms))
              const capture = async (name: string): Promise<void> => {
                const image = await mainWindow?.webContents.capturePage()
                if (image) {
                  fs.writeFileSync(path.join(process.cwd(), `capture-${name}.png`), image.toPNG())
                }
              }

              // 一键清理：只选“缩略图与图标缓存”，扫描完成后打开确认框（不确认）
              await mainWindow?.webContents.executeJavaScript(`location.hash = '#/clean'`)
              await sleep(800)
              await mainWindow?.webContents.executeJavaScript(`(() => {
                const norm = (s) => (s || '').replace(/\\s+/g, '')
                for (const btn of document.querySelectorAll('button')) {
                  if (norm(btn.textContent) === '清空') { btn.click(); break }
                }
                const card = [...document.querySelectorAll('.rule-card')].find((c) => c.textContent.includes('缩略图与图标缓存'))
                if (card) card.click()
              })()`)
              await sleep(400)
              await mainWindow?.webContents.executeJavaScript(`(() => {
                const norm = (s) => (s || '').replace(/\\s+/g, '')
                for (const btn of document.querySelectorAll('button')) {
                  if (norm(btn.textContent).includes('开始扫描')) { btn.click(); return true }
                }
                return false
              })()`)
              for (let i = 0; i < 60; i++) {
                const ready = await mainWindow?.webContents.executeJavaScript(
                  `!!document.querySelector('.summary-strip')`
                )
                if (ready) break
                await sleep(500)
              }
              await capture('clean-scan')
              await mainWindow?.webContents.executeJavaScript(`(() => {
                const norm = (s) => (s || '').replace(/\\s+/g, '')
                for (const btn of document.querySelectorAll('button')) {
                  const t = norm(btn.textContent)
                  if (t.startsWith('清理') && !t.includes('清空')) { btn.click(); return true }
                }
                return false
              })()`)
              await sleep(700)
              await capture('clean-confirm')
              await mainWindow?.webContents.executeJavaScript(`(() => {
                const norm = (s) => (s || '').replace(/\\s+/g, '')
                const cancel = [...document.querySelectorAll('.elp-message-box button')].find((b) =>
                  norm(b.textContent).includes('取消')
                )
                if (cancel) cancel.click()
              })()`)
              await sleep(600)
              await mainWindow?.webContents.executeJavaScript(`(() => {
                if (document.querySelector('.elp-message-box')) {
                  document.querySelector('.elp-message-box__headerbtn')?.click()
                }
                document.dispatchEvent(
                  new KeyboardEvent('keydown', {
                    key: 'Escape',
                    code: 'Escape',
                    keyCode: 27,
                    which: 27,
                    bubbles: true
                  })
                )
              })()`)
              await sleep(500)

              // 空间分析：启动扫描后 2.5 秒截图并取消，验证进度遮罩
              await mainWindow?.webContents.executeJavaScript(`location.hash = '#/analyze'`)
              await sleep(900)
              await mainWindow?.webContents.executeJavaScript(`(() => {
                const norm = (s) => (s || '').replace(/\\s+/g, '')
                for (const btn of document.querySelectorAll('button')) {
                  const t = norm(btn.textContent)
                  if (t.includes('开始分析') || t.includes('开始扫描')) {
                    btn.click()
                    return true
                  }
                }
                return false
              })()`)
              await sleep(2500)
              await capture('analyze-progress')
              await mainWindow?.webContents.executeJavaScript(`(() => {
                const norm = (s) => (s || '').replace(/\\s+/g, '')
                for (const btn of document.querySelectorAll('.progress-panel button')) {
                  if (norm(btn.textContent).includes('取消')) { btn.click(); return true }
                }
                return false
              })()`)
              await sleep(3000)

              // 空间分析：扫描项目 src 目录，验证树图/子目录/大文件表
              const demoPath = path.join(process.cwd(), 'src')
              await mainWindow?.webContents.executeJavaScript(
                `location.hash = '#/analyze?path=' + encodeURIComponent(${JSON.stringify(demoPath)}) + '&auto=1'`
              )
              await sleep(3500)
              await capture('analyze-result')

              // 重复文件：构造夹具，扫描、展开并实际移入回收站
              const dupRoot = path.join(process.cwd(), 'fixtures', 'dup-demo')
              fs.mkdirSync(dupRoot, { recursive: true })
              const duplicatePayload = Buffer.alloc(2 * 1024 * 1024, 7)
              fs.writeFileSync(path.join(dupRoot, 'a-copy.bin'), duplicatePayload)
              fs.writeFileSync(path.join(dupRoot, 'b-copy.bin'), duplicatePayload)
              fs.writeFileSync(path.join(dupRoot, 'c-diff.bin'), Buffer.alloc(2 * 1024 * 1024, 9))

              await mainWindow?.webContents.executeJavaScript(
                `location.hash = '#/duplicates?roots=' + encodeURIComponent(${JSON.stringify(dupRoot)})`
              )
              for (let i = 0; i < 60; i++) {
                const ready = await mainWindow?.webContents.executeJavaScript(
                  `!!document.querySelector('.dup-groups .elp-collapse-item')`
                )
                if (ready) break
                await sleep(500)
              }
              await capture('duplicates-result')

              await mainWindow?.webContents.executeJavaScript(`(() => {
                document.querySelector('.dup-groups .elp-collapse-item__header')?.click()
              })()`)
              await sleep(900)
              await capture('duplicates-detail')

              await mainWindow?.webContents.executeJavaScript(`(() => {
                const norm = (s) => (s || '').replace(/\\s+/g, '')
                for (const btn of document.querySelectorAll('button')) {
                  if (norm(btn.textContent) === '移入回收站') { btn.click(); return true }
                }
                return false
              })()`)
              await sleep(700)
              await capture('duplicates-confirm')

              await mainWindow?.webContents.executeJavaScript(`(() => {
                const norm = (s) => (s || '').replace(/\\s+/g, '')
                const btn = [...document.querySelectorAll('.elp-message-box button')].find((b) =>
                  norm(b.textContent).includes('移入回收站')
                )
                if (btn) btn.click()
              })()`)
              await sleep(2000)
              await capture('duplicates-after-delete')
            }

            log('info', '界面截图已生成')
          } catch (err) {
            log('error', '界面截图失败', err)
          }
        })()
      }, 2000)
    })
  }
})

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
})

process.on('uncaughtException', (err) => {
  log('error', '未捕获异常', err)
})

process.on('unhandledRejection', (reason) => {
  log('error', '未处理的 Promise 拒绝', reason)
})
