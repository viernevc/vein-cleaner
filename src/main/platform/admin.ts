import { execFile } from 'node:child_process'
import path from 'node:path'
import { runPowerShell } from './powershell'

let cache: { value: boolean; at: number } | null = null

/** 通过 whoami 的完整性级别 SID 判断是否已提权 */
async function whoamiHighIntegrity(): Promise<boolean | null> {
  try {
    const exe = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'whoami.exe')
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        exe,
        ['/groups', '/fo', 'csv', '/nh'],
        { windowsHide: true, timeout: 4000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
        (err, out) => (err ? reject(err) : resolve(out))
      )
    })
    return stdout.includes('S-1-16-12288') || stdout.includes('S-1-16-16384')
  } catch {
    return null
  }
}

async function powerShellIsInRole(): Promise<boolean | null> {
  try {
    const { stdout } = await runPowerShell(
      "[bool]([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
      6000
    )
    return stdout.trim().toLowerCase() === 'true'
  } catch {
    return null
  }
}

export async function isAdmin(force = false): Promise<boolean> {
  if (!force && cache && Date.now() - cache.at < 5000) return cache.value
  let value = await whoamiHighIntegrity()
  if (value === null) value = await powerShellIsInRole()
  const result = value === true
  cache = { value: result, at: Date.now() }
  return result
}
