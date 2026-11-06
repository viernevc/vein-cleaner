import { runPowerShell, runPowerShellJson } from './powershell'

const SIZE_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$sum = 0
Get-PSDrive -PSProvider FileSystem | ForEach-Object {
  $p = Join-Path $_.Root '$Recycle.Bin'
  if (Test-Path -LiteralPath $p) {
    $m = Get-ChildItem -LiteralPath $p -Force -Recurse -File -ErrorAction SilentlyContinue |
         Measure-Object -Property Length -Sum
    if ($m.Sum) { $sum += $m.Sum }
  }
}
[math]::Round($sum)
`

/** 估算回收站占用（只统计可访问部分，失败返回 0） */
export async function getRecycleBinSize(): Promise<number> {
  try {
    const { stdout } = await runPowerShell(SIZE_SCRIPT, 25000)
    const value = Number(stdout.trim())
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

export interface EmptyResult {
  ok: boolean
  message?: string
}

/** 清空所有驱动器回收站 */
export async function emptyRecycleBin(): Promise<EmptyResult> {
  try {
    await runPowerShell("$ErrorActionPreference='Stop'; Clear-RecycleBin -Force", 60000)
    return { ok: true }
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    return { ok: false, message: (e.stderr || e.message || '清空回收站失败').slice(0, 300) }
  }
}

/** 枚举回收站条目（用于清理后统计，可选） */
export async function listRecycleBinDrives(): Promise<string[]> {
  const rows = await runPowerShellJson<Array<{ Name?: string }>>(
    "Get-PSDrive -PSProvider FileSystem | Select-Object Name | ConvertTo-Json -Compress",
    10000
  )
  return (rows ?? []).map((r) => (r.Name || '').toUpperCase()).filter(Boolean)
}
