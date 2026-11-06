import { describe, expect, it } from 'vitest'
import { formatBytes, formatDuration, formatNumber } from '@shared/format'

describe('format', () => {
  it('格式化字节', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(-1)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB')
  })

  it('格式化时长', () => {
    expect(formatDuration(0)).toBe('0 秒')
    expect(formatDuration(59_000)).toBe('59 秒')
    expect(formatDuration(61_000)).toBe('1 分 1 秒')
    expect(formatDuration(3_600_000)).toBe('1 小时 0 分')
  })

  it('格式化数字', () => {
    expect(formatNumber(1234567)).toContain('1')
  })
})
