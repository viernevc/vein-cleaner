import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { walkTree } from '@main/fs/walker'
import { createOutcome, deleteFileSafe, deleteTreeSafe, type DeleteContext } from '@main/fs/delete-safe'
import { fullHash, partialHash } from '@main/fs/hash'

let root = ''

beforeAll(async () => {
  root = path.join(os.tmpdir(), `vein-test-${Date.now()}`)
  await fs.mkdir(path.join(root, 'a', 'b'), { recursive: true })
  await fs.mkdir(path.join(root, 'c'), { recursive: true })
  await fs.writeFile(path.join(root, 'top.txt'), 'hello')
  await fs.writeFile(path.join(root, 'a', 'one.bin'), Buffer.alloc(100, 1))
  await fs.writeFile(path.join(root, 'a', 'b', 'two.bin'), Buffer.alloc(200, 2))
  await fs.writeFile(path.join(root, 'c', 'three.bin'), Buffer.alloc(50, 3))
})

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('walker / delete-safe / hash', () => {
  it('遍历统计文件与目录', async () => {
    const files: string[] = []
    const dirs: string[] = []
    await walkTree(root, {
      signal: new AbortController().signal,
      concurrency: 4,
      onFile: (file) => files.push(file.path),
      onDir: (dir) => dirs.push(dir.path)
    })
    expect(files.length).toBe(4)
    expect(dirs.length).toBe(3)
  })

  it('清空目录内容并保留根目录', async () => {
    const copy = path.join(os.tmpdir(), `vein-del-${Date.now()}`)
    await fs.cp(root, copy, { recursive: true })
    const ctx: DeleteContext = { signal: new AbortController().signal, root: copy }
    const out = createOutcome()
    await deleteTreeSafe(copy, ctx, out, false)

    const remaining = await fs.readdir(copy)
    expect(remaining).toEqual([])
    expect(out.deletedFiles).toBe(4)
    expect(out.failedCount).toBe(0)
    expect(out.cancelled).toBe(false)
    await fs.rm(copy, { recursive: true, force: true })
  })

  it('拒绝删除根目录之外的文件', async () => {
    const outside = path.join(os.tmpdir(), `vein-outside-${Date.now()}.txt`)
    await fs.writeFile(outside, 'x')
    const ctx: DeleteContext = { signal: new AbortController().signal, root }
    const out = createOutcome()
    await deleteFileSafe(outside, ctx, out)
    expect(out.skippedCount).toBe(1)
    expect(out.deletedFiles).toBe(0)
    await fs.unlink(outside)
  })

  it('相同内容哈希一致，不同内容不一致', async () => {
    const same = path.join(root, 'same.txt')
    const diff = path.join(root, 'diff.txt')
    await fs.writeFile(same, 'hello')
    await fs.writeFile(diff, 'world')
    expect(await partialHash(same, 5)).toBe(await partialHash(path.join(root, 'top.txt'), 5))
    expect(await fullHash(same)).toBe(await fullHash(path.join(root, 'top.txt')))
    expect(await fullHash(diff)).not.toBe(await fullHash(same))
    await fs.unlink(same)
    await fs.unlink(diff)
  })
})
