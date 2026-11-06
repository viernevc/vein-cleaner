import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Settings } from '@shared/types'
import { TaskContext } from '@main/core/task-manager'
import { scanRules } from '@main/clean/scanner'
import type { CleanRule } from '@main/clean/rules'

const settings: Settings = {
  theme: 'light',
  slowMode: false,
  downloadAgeDays: 30,
  minDuplicateSize: 1024 * 1024,
  logDir: '',
  excludeDirs: [],
  lastCleanAt: null,
  lastCleanBytes: 0
}

let root = ''

function makeContext(): TaskContext {
  return new TaskContext('test-task', 'clean.scan', new AbortController(), () => undefined)
}

function makeRule(overrides: Partial<CleanRule> = {}): CleanRule {
  return {
    id: 'test-rule',
    group: 'system',
    name: '测试清理项',
    description: '测试',
    safety: 'low',
    adminRequired: false,
    defaultEnabled: true,
    deleteMode: 'permanent',
    targets: [{ template: root, recursive: true }],
    ...overrides
  }
}

beforeAll(async () => {
  root = path.join(os.tmpdir(), `vein-scan-${Date.now()}`)
  await fs.mkdir(path.join(root, 'sub'), { recursive: true })
  await fs.writeFile(path.join(root, 'a.log'), Buffer.alloc(120, 1))
  await fs.writeFile(path.join(root, 'sub', 'b.log'), Buffer.alloc(80, 2))
  await fs.writeFile(path.join(root, 'c.bin'), Buffer.alloc(40, 3))
})

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('clean scanner', () => {
  it('统计文件大小并生成明细', async () => {
    const outcome = await scanRules([makeRule()], makeContext(), settings, true)
    expect(outcome.summaries).toHaveLength(1)
    const summary = outcome.summaries[0]
    expect(summary.status).toBe('ok')
    expect(summary.files).toBe(3)
    expect(summary.bytes).toBe(240)
    expect(summary.dirs).toBe(1)
    expect(outcome.entries.get('test-rule')?.items.length).toBe(3)
    expect(outcome.totalBytes).toBe(240)
  })

  it('按扩展名过滤', async () => {
    const rule = makeRule({
      targets: [{ template: root, recursive: true, filePatterns: ['*.log'] }]
    })
    const outcome = await scanRules([rule], makeContext(), settings, true)
    expect(outcome.summaries[0].files).toBe(2)
    expect(outcome.summaries[0].bytes).toBe(200)
  })

  it('未提权时管理员项标记为跳过', async () => {
    const rule = makeRule({ adminRequired: true })
    const outcome = await scanRules([rule], makeContext(), settings, false)
    expect(outcome.summaries[0].status).toBe('admin-skipped')
    expect(outcome.summaries[0].bytes).toBe(0)
  })

  it('按修改时间过滤旧文件', async () => {
    const oldFile = path.join(root, 'old.log')
    await fs.writeFile(oldFile, Buffer.alloc(10, 4))
    const past = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
    await fs.utimes(oldFile, past, past)
    const rule = makeRule({
      targets: [{ template: root, recursive: true, minAgeDays: 5 }]
    })
    const outcome = await scanRules([rule], makeContext(), settings, true)
    expect(outcome.summaries[0].files).toBe(1)
    expect(outcome.summaries[0].bytes).toBe(10)
    await fs.unlink(oldFile)
  })

  it('取消时抛出 AbortError，不提交部分结果', async () => {
    const controller = new AbortController()
    controller.abort()
    const ctx = new TaskContext('cancelled-task', 'clean.scan', controller, () => undefined)
    await expect(scanRules([makeRule()], ctx, settings, true)).rejects.toThrow()
  })
})
