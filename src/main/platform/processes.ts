import { execFile } from 'node:child_process'
import path from 'node:path'

const TASKLIST = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tasklist.exe')

let lastScan: { at: number; output: string } | null = null

async function listProcesses(): Promise<string> {
  const now = Date.now()
  if (lastScan && now - lastScan.at < 5000) return lastScan.output
  const output = await new Promise<string>((resolve) => {
    execFile(
      TASKLIST,
      ['/NH'],
      { windowsHide: true, timeout: 5000, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => resolve(err ? '' : stdout.toLowerCase())
    )
  })
  lastScan = { at: now, output }
  return output
}

/** 检测给定可执行文件名是否有进程在运行 */
export async function isProcessRunning(exeNames: string[]): Promise<boolean> {
  if (!exeNames.length) return false
  const output = await listProcesses()
  if (!output) return false
  return exeNames.some((name) => output.includes(name.toLowerCase()))
}
