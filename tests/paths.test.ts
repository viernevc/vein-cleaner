import { describe, expect, it } from 'vitest'
import path from 'node:path'
import {
  expandEnv,
  isInside,
  isProtectedPath,
  matchPattern,
  normKey,
  toDisplay,
  toExtended
} from '@main/core/paths'

describe('paths', () => {
  it('展开白名单环境变量', () => {
    const temp = expandEnv('%TEMP%')
    expect(temp).toBeTruthy()
    expect(path.win32.isAbsolute(temp as string)).toBe(true)
  })

  it('拒绝未知环境变量与父目录跳转', () => {
    expect(expandEnv('%NOT_A_REAL_VAR%')).toBeNull()
    expect(expandEnv('%TEMP%\\..\\..\\Windows')).toBeNull()
  })

  it('长路径前缀可往返转换', () => {
    const normal = 'C:\\Users\\demo\\very\\long\\path'
    const extended = toExtended(normal)
    expect(extended.startsWith('\\\\?\\')).toBe(true)
    expect(toDisplay(extended)).toBe(normal)
  })

  it('盘符根目录不添加扩展前缀', () => {
    expect(toExtended('C:')).toBe('C:\\')
    expect(toExtended('C:\\')).toBe('C:\\')
  })

  it('isInside 使用大小写不敏感与分隔符边界', () => {
    expect(isInside('C:\\Windows\\Temp\\a.txt', 'C:\\Windows\\Temp')).toBe(true)
    expect(isInside('C:\\WINDOWS\\temp', 'c:\\windows\\TEMP')).toBe(true)
    expect(isInside('C:\\Windows\\Temp2\\a.txt', 'C:\\Windows\\Temp')).toBe(false)
    expect(isInside('C:\\Windows\\Temp', 'C:\\Windows\\Temp')).toBe(true)
  })

  it('normKey 去除尾部分隔符', () => {
    expect(normKey('C:\\Users\\Demo\\')).toBe('c:\\users\\demo')
  })

  it('保护系统敏感目录', () => {
    const winDir = process.env.WINDIR || 'C:\\Windows'
    expect(isProtectedPath(path.win32.join(winDir, 'System32'))).toBe(true)
    expect(isProtectedPath(path.win32.join(winDir, 'System32', 'drivers'))).toBe(true)
    expect(isProtectedPath(winDir)).toBe(true)
    expect(isProtectedPath(path.win32.join(winDir, 'Temp'))).toBe(false)
  })

  it('文件名通配匹配', () => {
    expect(matchPattern('thumbcache_256.db', 'thumbcache_*.db')).toBe(true)
    expect(matchPattern('iconcache_32.db', 'thumbcache_*.db')).toBe(false)
    expect(matchPattern('setup.CRDOWNLOAD', '*.crdownload')).toBe(true)
    expect(matchPattern('ab.txt', 'a?.txt')).toBe(true)
  })
})
