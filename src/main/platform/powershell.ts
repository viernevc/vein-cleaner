import { execFile } from 'node:child_process'
import path from 'node:path'

const PS_EXE = path.win32.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe'
)

/** PowerShell 单引号字符串转义 */
export function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** 以 EncodedCommand 执行 PowerShell，避免引号/编码问题 */
export function runPowerShell(
  script: string,
  timeout = 30000
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    execFile(
      PS_EXE,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err) {
          reject(Object.assign(err, { stdout, stderr }))
          return
        }
        resolve({ stdout, stderr })
      }
    )
  })
}

export async function runPowerShellJson<T>(script: string, timeout = 30000): Promise<T | null> {
  const { stdout } = await runPowerShell(script, timeout)
  const text = stdout.trim()
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}
