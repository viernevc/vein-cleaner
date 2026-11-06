import fs from 'node:fs/promises'
import type { DriveInfo } from '@shared/types'
import { runPowerShellJson } from './powershell'

interface VolumeRow {
  DeviceID?: string
  VolumeName?: string | null
  FileSystem?: string | null
}

type LabelMap = Map<string, { label: string; fs: string }>

let cache: { at: number; data: DriveInfo[] } | null = null
let labelCache: { at: number; data: LabelMap } | null = null
let labelInFlight: Promise<LabelMap> | null = null

const LABEL_TTL = 5 * 60 * 1000
const DRIVE_TTL = 15 * 1000

async function fetchVolumeLabels(): Promise<LabelMap> {
  const map: LabelMap = new Map()
  try {
    const rows = await runPowerShellJson<VolumeRow[] | VolumeRow>(
      'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,FileSystem | ConvertTo-Json -Compress',
      8000
    )
    if (!rows) return map
    const list = Array.isArray(rows) ? rows : [rows]
    for (const row of list) {
      const id = (row.DeviceID || '').replace(':', '').toUpperCase()
      if (!id) continue
      map.set(id, { label: row.VolumeName || '', fs: row.FileSystem || '' })
    }
  } catch {
    // 卷标获取失败不影响容量统计
  }
  return map
}

function ensureLabels(): Promise<LabelMap> {
  if (labelCache && Date.now() - labelCache.at < LABEL_TTL) {
    return Promise.resolve(labelCache.data)
  }
  if (!labelInFlight) {
    labelInFlight = fetchVolumeLabels()
      .then((map) => {
        if (map.size) labelCache = { at: Date.now(), data: map }
        return map
      })
      .catch(() => new Map())
      .finally(() => {
        labelInFlight = null
      })
  }
  return labelInFlight
}

export async function getDrives(force = false): Promise<DriveInfo[]> {
  if (!force && cache && Date.now() - cache.at < DRIVE_TTL) {
    return cache.data
  }

  // 卷标通过 PowerShell 获取，可能较慢：先用已有缓存，后台预热
  const labels = labelCache?.data ?? new Map<string, { label: string; fs: string }>()
  void ensureLabels()

  const data: DriveInfo[] = []
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i)
    const root = `${letter}:\\`
    try {
      const st = await fs.statfs(root)
      const total = Number(st.bsize) * Number(st.blocks)
      const free = Number(st.bsize) * Number(st.bfree)
      if (!Number.isFinite(total) || total <= 0) continue
      const meta = labels.get(letter)
      data.push({
        letter,
        name: `${letter}:`,
        label: meta?.label || '',
        fs: meta?.fs || '',
        total,
        free
      })
    } catch {
      // 驱动器不存在或无访问权限
    }
  }

  // 卷标缺失时缩短缓存，便于下一次调用补齐卷标
  const hasMissingLabel = data.some((d) => !d.label)
  cache = { at: hasMissingLabel ? Date.now() - (DRIVE_TTL - 3000) : Date.now(), data }
  return data
}
