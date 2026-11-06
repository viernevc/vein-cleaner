import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: () => process.cwd()
  }
}))

import { migrateLogFiles } from '@main/core/log-migration'
import { getLogsDir, initLogger, log, setLogsDir } from '@main/core/logger'

let base = ''
let dirA = ''
let dirB = ''

beforeEach(() => {
  base = path.join(os.tmpdir(), `vein-log-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  dirA = path.join(base, 'a')
  dirB = path.join(base, 'b')
  fs.mkdirSync(dirA, { recursive: true })
  fs.mkdirSync(dirB, { recursive: true })
})

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true })
})

describe('migrateLogFiles', () => {
  it('移动日志文件到新目录', () => {
    fs.writeFileSync(path.join(dirA, 'vein.log'), 'hello\n')
    fs.writeFileSync(path.join(dirA, 'vein.old.log'), 'old\n')

    const result = migrateLogFiles(dirA, dirB)
    expect(result.moved.sort()).toEqual(['vein.log', 'vein.old.log'])
    expect(result.failed).toEqual([])
    expect(fs.readFileSync(path.join(dirB, 'vein.log'), 'utf8')).toBe('hello\n')
    expect(fs.readFileSync(path.join(dirB, 'vein.old.log'), 'utf8')).toBe('old\n')
    expect(fs.existsSync(path.join(dirA, 'vein.log'))).toBe(false)
  })

  it('目标已存在时追加而不覆盖', () => {
    fs.writeFileSync(path.join(dirA, 'vein.log'), 'new\n')
    fs.writeFileSync(path.join(dirB, 'vein.log'), 'old\n')

    const result = migrateLogFiles(dirA, dirB)
    expect(result.moved).toEqual(['vein.log'])
    expect(fs.readFileSync(path.join(dirB, 'vein.log'), 'utf8')).toBe('old\nnew\n')
    expect(fs.existsSync(path.join(dirA, 'vein.log'))).toBe(false)
  })

  it('源目录与目标目录相同时不做处理', () => {
    fs.writeFileSync(path.join(dirA, 'vein.log'), 'x\n')
    const result = migrateLogFiles(dirA, dirA)
    expect(result.moved).toEqual([])
    expect(fs.existsSync(path.join(dirA, 'vein.log'))).toBe(true)
  })
})

describe('setLogsDir', () => {
  it('切换目录并迁移当前日志', () => {
    initLogger(dirA)
    log('info', 'hello')
    expect(fs.readFileSync(path.join(dirA, 'vein.log'), 'utf8')).toContain('hello')

    const result = setLogsDir(dirB)
    expect(result.ok).toBe(true)
    expect(result.moved).toContain('vein.log')
    expect(getLogsDir()).toBe(path.win32.normalize(dirB))
    expect(fs.existsSync(path.join(dirA, 'vein.log'))).toBe(false)

    const content = fs.readFileSync(path.join(dirB, 'vein.log'), 'utf8')
    expect(content).toContain('hello')
    expect(content).toContain('日志目录已切换')
  })

  it('拒绝相对路径', () => {
    initLogger(dirA)
    const result = setLogsDir('relative-logs')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('绝对路径')
  })
})
