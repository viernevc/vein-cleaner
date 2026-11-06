import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Settings } from '@shared/types'
import { TaskContext } from '@main/core/task-manager'
import {
  queryChildren,
  queryTopFiles,
  queryTreemap,
  scanAnalyze
} from '@main/analyze/analyzer'

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

function makeContext(id: string, aborted = false): TaskContext {
  const controller = new AbortController()
  if (aborted) controller.abort()
  return new TaskContext(id, 'analyze.scan', controller, () => undefined)
}

beforeAll(async () => {
  root = path.join(os.tmpdir(), `vein-analyze-${Date.now()}`)
  await fs.mkdir(path.join(root, 'big'), { recursive: true })
  await fs.mkdir(path.join(root, 'small'), { recursive: true })
  await fs.writeFile(path.join(root, 'big', 'a.bin'), Buffer.alloc(300, 1))
  await fs.writeFile(path.join(root, 'small', 'b.bin'), Buffer.alloc(100, 2))
  await fs.writeFile(path.join(root, 'top.txt'), Buffer.alloc(50, 3))
})

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('analyze', () => {
  it('聚合目录大小并返回树图和大文件', async () => {
    const result = await scanAnalyze(makeContext('analyze-1'), root, settings)
    expect(result.totalFiles).toBe(3)
    expect(result.totalBytes).toBe(450)
    expect(result.totalDirs).toBe(2)
    expect(result.root.size).toBe(450)

    const children = queryChildren('analyze-1', root, 0, 10)
    expect(children.total).toBe(2)
    expect(children.items[0].name).toBe('big')
    expect(children.items[0].size).toBe(300)

    const tree = queryTreemap('analyze-1', root, 3, 100)
    expect(tree?.children?.length).toBe(2)

    const top = queryTopFiles('analyze-1', 10)
    expect(top[0].name).toBe('a.bin')
    expect(top[0].size).toBe(300)
  })

  it('取消时抛出 AbortError 且不提交结果', async () => {
    await expect(scanAnalyze(makeContext('analyze-cancel', true), root, settings)).rejects.toThrow()
    expect(queryChildren('analyze-cancel', root, 0, 10).total).toBe(0)
  })

  it('提供已用容量时进度为可计算的百分比', async () => {
    const patches: Array<{ percent?: number | null; bytesTotal?: number | null }> = []
    const controller = new AbortController()
    const ctx = new TaskContext('analyze-progress', 'analyze.scan', controller, (patch) => {
      patches.push({ percent: patch.percent, bytesTotal: patch.bytesTotal })
    })
    const result = await scanAnalyze(ctx, root, settings, 900)
    expect(result.totalBytes).toBe(450)
    expect(patches.some((p) => typeof p.percent === 'number' && p.percent > 0 && p.percent <= 99)).toBe(
      true
    )
    expect(patches.some((p) => p.bytesTotal === 900)).toBe(true)
  })
})
