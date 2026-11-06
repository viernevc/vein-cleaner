import fs from 'node:fs/promises'
import path from 'node:path'
import { toExtended } from '../core/paths'
import { fsErrorInfo } from '../core/errors'

export interface WalkFile {
  path: string
  name: string
  size: number
  mtimeMs: number
  depth: number
}

export interface WalkDir {
  path: string
  name: string
  depth: number
}

export interface WalkOptions {
  signal: AbortSignal
  concurrency?: number
  /** 返回跳过原因则跳过该目录/文件；返回 null 表示继续 */
  ignore?: (name: string, fullPath: string, isDir: boolean) => string | null
  onFile: (file: WalkFile) => void
  onDir?: (dir: WalkDir) => void
  onSkip?: (fullPath: string, reason: string, code?: string) => void
  onError?: (fullPath: string, code: string) => void
}

interface QueueItem {
  dir: string
  depth: number
}

/** 目录任务队列：空队列时等待其他 worker 可能追加的子目录 */
class DirQueue {
  private items: QueueItem[] = []
  private pending = 0
  private waiters: Array<() => void> = []
  private closed = false

  add(item: QueueItem): void {
    this.pending++
    this.items.push(item)
    this.wake()
  }

  done(): void {
    this.pending--
    if (this.pending <= 0) {
      this.closed = true
      this.wake()
    }
  }

  async next(): Promise<QueueItem | null> {
    while (true) {
      const item = this.items.shift()
      if (item) return item
      if (this.closed) return null
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
  }

  private wake(): void {
    const waiters = this.waiters
    this.waiters = []
    for (const resolve of waiters) resolve()
  }
}

/**
 * 迭代式目录遍历：
 * - 不跟随符号链接 / junction（Node 将 junction 识别为 symlink）
 * - 并发受控
 * - 通过 signal 取消
 */
export async function walkTree(root: string, opts: WalkOptions): Promise<void> {
  const signal = opts.signal
  const concurrency = Math.max(1, Math.min(64, opts.concurrency ?? 16))
  const queue = new DirQueue()
  const rootStat = await fs.lstat(toExtended(root)).catch(() => null)
  if (!rootStat) {
    opts.onError?.(root, 'ENOENT')
    return
  }
  if (rootStat.isSymbolicLink()) {
    opts.onSkip?.(root, 'reparse-point')
    return
  }

  queue.add({ dir: root, depth: 0 })

  const processDir = async (item: QueueItem): Promise<void> => {
    if (signal.aborted) return
    let entries
    try {
      entries = await fs.readdir(toExtended(item.dir), { withFileTypes: true })
    } catch (err) {
      const info = fsErrorInfo(err)
      opts.onError?.(item.dir, info.code)
      return
    }

    const fileEntries: import('node:fs').Dirent[] = []

    for (const ent of entries) {
      if (signal.aborted) return
      const full = path.win32.join(item.dir, ent.name)
      const isDir = ent.isDirectory()
      const reason = opts.ignore?.(ent.name, full, isDir) ?? null
      if (reason) {
        opts.onSkip?.(full, reason)
        continue
      }
      if (ent.isSymbolicLink()) {
        opts.onSkip?.(full, 'reparse-point')
        continue
      }
      if (isDir) {
        opts.onDir?.({ path: full, name: ent.name, depth: item.depth + 1 })
        queue.add({ dir: full, depth: item.depth + 1 })
        continue
      }
      if (!ent.isFile()) {
        opts.onSkip?.(full, 'special-file')
        continue
      }
      fileEntries.push(ent)
    }

    // 平铺目录中并行 stat，避免单个超大目录成为瓶颈
    const CHUNK = 32
    for (let i = 0; i < fileEntries.length; i += CHUNK) {
      if (signal.aborted) return
      await Promise.all(
        fileEntries.slice(i, i + CHUNK).map(async (ent) => {
          const full = path.win32.join(item.dir, ent.name)
          try {
            const st = await fs.lstat(toExtended(full))
            if (st.isSymbolicLink()) {
              opts.onSkip?.(full, 'reparse-point')
              return
            }
            if (!st.isFile()) {
              opts.onSkip?.(full, 'special-file')
              return
            }
            opts.onFile({
              path: full,
              name: ent.name,
              size: st.size,
              mtimeMs: st.mtimeMs,
              depth: item.depth
            })
          } catch (err) {
            const info = fsErrorInfo(err)
            opts.onError?.(full, info.code)
          }
        })
      )
    }
  }

  const workers: Promise<void>[] = []
  for (let i = 0; i < concurrency; i++) {
    workers.push(
      (async () => {
        while (!signal.aborted) {
          const item = await queue.next()
          if (!item) return
          try {
            await processDir(item)
          } finally {
            queue.done()
          }
        }
      })()
    )
  }

  await Promise.all(workers)
}
