import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ResumeTask } from '@shared/types'
import { log } from '../core/logger'
import { psQuote, runPowerShell } from './powershell'

interface PendingClean extends ResumeTask {
  v: 1
  expiresAt: number
  appVersion: string
}

const TTL_MS = 10 * 60 * 1000

function pendingFile(): string {
  return path.join(app.getPath('userData'), 'resume', 'pending-clean.json')
}

function writePending(ruleIds: string[]): PendingClean {
  const pending: PendingClean = {
    v: 1,
    kind: 'clean',
    ruleIds: [...new Set(ruleIds)].slice(0, 100),
    token: randomBytes(16).toString('hex'),
    createdAt: Date.now(),
    expiresAt: Date.now() + TTL_MS,
    appVersion: app.getVersion()
  }
  const file = pendingFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(pending, null, 2), 'utf8')
  return pending
}

function readPending(): PendingClean | null {
  try {
    const data = JSON.parse(fs.readFileSync(pendingFile(), 'utf8')) as PendingClean
    if (data?.v !== 1 || data.kind !== 'clean' || !Array.isArray(data.ruleIds)) return null
    if (!data.token || typeof data.token !== 'string') return null
    if (Date.now() > data.expiresAt) return null
    if (data.appVersion !== app.getVersion()) return null
    return data
  } catch {
    return null
  }
}

export function clearPending(): void {
  try {
    fs.unlinkSync(pendingFile())
  } catch {
    // 不存在
  }
}

/** 从命令行读取提权续跑任务；校验 token 与 TTL，成功后立即删除文件 */
export function consumeResumeFromArgv(argv: string[]): ResumeTask | null {
  const isElevated = argv.includes('--elevated')
  const tokenArg = argv.find((a) => a.startsWith('--resume-token='))
  if (!isElevated || !tokenArg) return null
  const token = tokenArg.slice('--resume-token='.length)
  const pending = readPending()
  if (!pending || pending.token !== token) {
    log('warn', '提权续跑 token 校验失败')
    return null
  }
  clearPending()
  return { kind: 'clean', ruleIds: pending.ruleIds, token: pending.token, createdAt: pending.createdAt }
}

/**
 * 以管理员身份重新启动应用并续跑清理任务。
 * 成功时原进程稍后退出；UAC 取消则回滚并返回错误。
 */
export async function relaunchElevated(ruleIds: string[]): Promise<{ ok: boolean; error?: string }> {
  const pending = writePending(ruleIds)
  const exe = process.execPath
  const args = app.isPackaged
    ? ['--elevated', `--resume-token=${pending.token}`]
    : [app.getAppPath(), '--elevated', `--resume-token=${pending.token}`]
  const workingDir = app.isPackaged ? path.dirname(process.execPath) : app.getAppPath()

  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$exe = ${psQuote(exe)}`,
    `$argList = @(${args.map(psQuote).join(', ')})`,
    `Start-Process -FilePath $exe -ArgumentList $argList -WorkingDirectory ${psQuote(workingDir)} -Verb RunAs`
  ].join('\n')

  app.releaseSingleInstanceLock()
  try {
    await runPowerShell(script, 60000)
    setTimeout(() => app.quit(), 400)
    return { ok: true }
  } catch (err) {
    log('warn', '提权启动失败', err)
    clearPending()
    app.requestSingleInstanceLock()
    return { ok: false, error: '管理员授权已取消，或提权启动失败。' }
  }
}
