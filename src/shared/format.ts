/** 纯格式化工具，主/渲染进程共用 */

export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  const fixed = i === 0 ? 0 : digits
  return `${value.toFixed(fixed)} ${units[i]}`
}

export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('zh-CN')
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '--'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  const rest = s % 60
  if (m < 60) return rest ? `${m} 分 ${rest} 秒` : `${m} 分钟`
  const h = Math.floor(m / 60)
  return `${h} 小时 ${m % 60} 分`
}

export function formatPercent(value: number): string {
  return `${Math.max(0, Math.min(100, value)).toFixed(0)}%`
}

export function formatTime(ts: number | null): string {
  if (!ts) return '--'
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

export function dirname(p: string): string {
  const idx = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return idx > 0 ? p.slice(0, idx) : p
}
