import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { migrateLogFiles } from './log-migration'

let logFile: string | null = null
let logDir = ''
const MAX_SIZE = 2 * 1024 * 1024

export interface LogDirChangeResult {
  ok: boolean
  dir: string
  moved: string[]
  failed: string[]
  error?: string
}

function ensureWritableDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
  const probe = path.join(dir, `.write-test-${process.pid}`)
  fs.writeFileSync(probe, 'test', 'utf8')
  fs.unlinkSync(probe)
}

function rotateIfNeeded(): void {
  if (!logFile) return
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_SIZE) {
      fs.renameSync(logFile, path.join(logDir, 'vein.old.log'))
    }
  } catch {
    // 忽略轮转失败
  }
}

/**
 * 优先使用自定义目录；否则写入安装目录 logs：
 * - NSIS 用户级安装：安装目录可写
 * - 便携版：写在便携 exe 同级目录
 * - Program Files / 只读位置：自动回退到 userData/logs
 */
export function resolveLogsDir(userDataPath: string, customDir?: string): string {
  const candidates: string[] = []
  const requested = customDir?.trim()
  if (requested && path.win32.isAbsolute(requested)) {
    candidates.push(path.win32.normalize(requested))
  }

  if (app.isPackaged) {
    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
    if (portableDir) candidates.push(path.join(portableDir, 'logs'))
    candidates.push(path.join(path.dirname(app.getPath('exe')), 'logs'))
  } else {
    candidates.push(path.join(app.getAppPath(), 'logs'))
  }
  candidates.push(path.join(userDataPath, 'logs'))

  for (const dir of candidates) {
    try {
      ensureWritableDir(dir)
      return dir
    } catch {
      // 当前目录不可写，尝试下一个
    }
  }
  return path.join(userDataPath, 'logs')
}

/** 运行时切换日志目录，并把现有 vein.log / vein.old.log 迁移过去 */
export function setLogsDir(newDir: string): LogDirChangeResult {
  const raw = newDir.trim()
  if (!raw || !path.win32.isAbsolute(raw)) {
    return { ok: false, dir: logDir, moved: [], failed: [], error: '日志目录必须是绝对路径' }
  }

  const target = path.win32.normalize(raw)
  try {
    ensureWritableDir(target)
  } catch (err) {
    const message = (err as NodeJS.ErrnoException).message || '目录不可写'
    return {
      ok: false,
      dir: logDir,
      moved: [],
      failed: [],
      error: `无法写入日志目录：${message}`
    }
  }

  const previous = logDir
  const { moved, failed } = migrateLogFiles(previous, target)

  logDir = target
  logFile = path.join(target, 'vein.log')
  rotateIfNeeded()
  log('info', '日志目录已切换', { from: previous, to: target, moved, failed })
  return { ok: true, dir: target, moved, failed }
}

export function getLogsDir(): string {
  return logDir
}

export function initLogger(dir: string): string {
  logDir = dir
  try {
    fs.mkdirSync(dir, { recursive: true })
    logFile = path.join(dir, 'vein.log')
    rotateIfNeeded()
  } catch {
    logFile = null
  }
  return logFile ?? ''
}

export function log(level: 'info' | 'warn' | 'error', message: string, meta?: unknown): void {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}${
    meta === undefined ? '' : ' ' + safeStringify(meta)
  }\n`
  if (!logFile) {
    if (level === 'error') console.error(line.trim())
    return
  }
  try {
    fs.appendFileSync(logFile, line, 'utf8')
  } catch {
    // 日志失败不影响主流程
  }
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    return String(value)
  }
}
