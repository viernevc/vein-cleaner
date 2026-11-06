import fs from 'node:fs'
import path from 'node:path'
import { runPowerShellJson } from './powershell'
import { log } from '../core/logger'

export interface ServiceState {
  name: string
  wasRunning: boolean
}

interface Journal {
  services: ServiceState[]
  createdAt: number
}

function journalPath(userDataPath: string): string {
  return path.join(userDataPath, 'service-journal.json')
}

function writeJournal(userDataPath: string, services: ServiceState[]): void {
  try {
    const data: Journal = { services, createdAt: Date.now() }
    fs.writeFileSync(journalPath(userDataPath), JSON.stringify(data), 'utf8')
  } catch (err) {
    log('warn', '写入服务恢复日志失败', err)
  }
}

function clearJournal(userDataPath: string): void {
  try {
    fs.unlinkSync(journalPath(userDataPath))
  } catch {
    // 文件不存在
  }
}

/**
 * 停止清理所需服务，返回原本运行中的服务列表。
 * 单个服务失败不中断，尽量继续。
 */
export async function stopServices(names: string[], userDataPath: string): Promise<ServiceState[]> {
  if (!names.length) return []
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$names = @(${names.map((n) => `'${n.replace(/'/g, "''")}'`).join(',')})
$out = @()
foreach ($n in $names) {
  $s = Get-Service -Name $n -ErrorAction SilentlyContinue
  if ($s) {
    $was = ($s.Status -eq 'Running')
    if ($was) { Stop-Service -Name $n -Force -ErrorAction SilentlyContinue }
    $out += [pscustomobject]@{ name = $n; wasRunning = $was }
  }
}
$out | ConvertTo-Json -Compress
`
  let states: ServiceState[] = []
  try {
    const rows = await runPowerShellJson<ServiceState[] | ServiceState>(script, 40000)
    const list = rows ? (Array.isArray(rows) ? rows : [rows]) : []
    states = list.map((r) => ({ name: r.name, wasRunning: !!r.wasRunning }))
    writeJournal(userDataPath, states)
  } catch (err) {
    log('warn', '停止服务失败', { names, err })
  }
  return states
}

/** 恢复之前处于运行状态的服务 */
export async function restoreServices(states: ServiceState[], userDataPath: string): Promise<void> {
  const toStart = states.filter((s) => s.wasRunning).map((s) => s.name)
  if (toStart.length) {
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
$names = @(${toStart.map((n) => `'${n.replace(/'/g, "''")}'`).join(',')})
foreach ($n in $names) { Start-Service -Name $n -ErrorAction SilentlyContinue }
$true
`
    try {
      await runPowerShellJson(script, 40000)
    } catch (err) {
      log('warn', '恢复服务失败', { toStart, err })
    }
  }
  clearJournal(userDataPath)
}

/** 应用启动时若发现未完成的 journal，尝试恢复服务 */
export async function recoverJournalOnStartup(userDataPath: string): Promise<void> {
  const file = journalPath(userDataPath)
  if (!fs.existsSync(file)) return
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as Journal
    if (data?.services?.length) {
      log('info', '发现未完成的服务恢复记录，正在恢复', data.services)
      await restoreServices(data.services, userDataPath)
    } else {
      clearJournal(userDataPath)
    }
  } catch {
    clearJournal(userDataPath)
  }
}
