import { describe, expect, it } from 'vitest'
import { isFileWanted } from '@main/clean/rule-resolver'
import type { ResolvedTarget } from '@main/clean/rule-resolver'

const base: ResolvedTarget = {
  root: 'C:\\test',
  recursive: true,
  removeRoot: false
}

describe('isFileWanted', () => {
  const now = 1_000_000_000_000

  it('无限制时接受所有文件', () => {
    expect(isFileWanted('a.bin', now, base, now)).toBe(true)
  })

  it('按修改时间过滤', () => {
    const target: ResolvedTarget = { ...base, minAgeMs: 1000 }
    expect(isFileWanted('old.bin', now - 2000, target, now)).toBe(true)
    expect(isFileWanted('new.bin', now - 500, target, now)).toBe(false)
  })

  it('包含模式优先', () => {
    const target: ResolvedTarget = { ...base, filePatterns: ['*.db'] }
    expect(isFileWanted('thumb.db', now, target, now)).toBe(true)
    expect(isFileWanted('readme.txt', now, target, now)).toBe(false)
  })

  it('排除模式生效', () => {
    const target: ResolvedTarget = { ...base, excludePatterns: ['*.crdownload'] }
    expect(isFileWanted('file.crdownload', now, target, now)).toBe(false)
    expect(isFileWanted('file.zip', now, target, now)).toBe(true)
  })
})
