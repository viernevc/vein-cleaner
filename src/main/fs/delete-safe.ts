import fs from 'node:fs/promises'
import path from 'node:path'
import type { FailureEntry } from '@shared/types'
import { fsErrorInfo } from '../core/errors'
import { isInside, isProtectedPath, toExtended } from '../core/paths'

export interface DeleteContext {
  signal: AbortSignal
  /** 规则展开后的允许根目录 */
  root: string
  onProgress?: (deletedBytes: number, deletedFiles: number) => void
}

export interface DeleteOutcome {
  deletedBytes: number
  deletedFiles: number
  deletedDirs: number
  failures: FailureEntry[]
  skipped: FailureEntry[]
  failedCount: number
  skippedCount: number
  cancelled: boolean
}

const SAMPLE_LIMIT = 200

export function createOutcome(): DeleteOutcome {
  return {
    deletedBytes: 0,
    deletedFiles: 0,
    deletedDirs: 0,
    failures: [],
    skipped: [],
    failedCount: 0,
    skippedCount: 0,
    cancelled: false
  }
}

function record(
  list: FailureEntry[],
  entry: FailureEntry,
  inc: () => void
): void {
  inc()
  if (list.length < SAMPLE_LIMIT) list.push(entry)
}

async function lstatSafe(p: string): Promise<import('node:fs').Stats | null> {
  try {
    return await fs.lstat(toExtended(p))
  } catch {
    return null
  }
}

function guard(target: string, ctx: DeleteContext, out: DeleteOutcome): boolean {
  if (!isInside(target, ctx.root) || isProtectedPath(target)) {
    record(out.skipped, { path: target, code: 'E_GUARD', message: '路径未通过安全校验' }, () => {
      out.skippedCount++
    })
    return false
  }
  return true
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 删除单个文件（带只读属性处理与占用重试） */
export async function deleteFileSafe(filePath: string, ctx: DeleteContext, out: DeleteOutcome): Promise<void> {
  if (!guard(filePath, ctx, out)) return

  const st = await lstatSafe(filePath)
  if (!st) {
    record(out.skipped, { path: filePath, code: 'ENOENT', message: '文件已不存在' }, () => {
      out.skippedCount++
    })
    return
  }
  if (st.isSymbolicLink()) {
    record(out.skipped, { path: filePath, code: 'E_REPARSE', message: '符号链接/目录联接，已跳过' }, () => {
      out.skippedCount++
    })
    return
  }
  if (!st.isFile()) {
    record(out.skipped, { path: filePath, code: 'E_NOT_FILE', message: '不是普通文件' }, () => {
      out.skippedCount++
    })
    return
  }

  let lastError: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fs.unlink(toExtended(filePath))
      out.deletedFiles++
      out.deletedBytes += st.size
      ctx.onProgress?.(out.deletedBytes, out.deletedFiles)
      return
    } catch (err) {
      lastError = err
      const code = (err as NodeJS.ErrnoException).code
      if ((code === 'EPERM' || code === 'EACCES') && attempt === 0) {
        try {
          await fs.chmod(toExtended(filePath), 0o666)
        } catch {
          // 忽略
        }
        continue
      }
      if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
        await sleep(60 * 2 ** attempt)
        continue
      }
      break
    }
  }

  const info = fsErrorInfo(lastError)
  record(
    out.failures,
    { path: filePath, code: info.code, message: info.message },
    () => {
      out.failedCount++
    }
  )
}

/** 递归删除目录内容；removeRoot 为 true 时连目录本身一起删除 */
export async function deleteTreeSafe(
  dirPath: string,
  ctx: DeleteContext,
  out: DeleteOutcome,
  removeRoot: boolean
): Promise<void> {
  if (ctx.signal.aborted) {
    out.cancelled = true
    return
  }
  if (!guard(dirPath, ctx, out)) return

  const st = await lstatSafe(dirPath)
  if (!st) {
    record(out.skipped, { path: dirPath, code: 'ENOENT', message: '目录已不存在' }, () => {
      out.skippedCount++
    })
    return
  }
  if (st.isSymbolicLink()) {
    record(out.skipped, { path: dirPath, code: 'E_REPARSE', message: '符号链接/目录联接，已跳过' }, () => {
      out.skippedCount++
    })
    return
  }
  if (!st.isDirectory()) {
    await deleteFileSafe(dirPath, ctx, out)
    return
  }

  let entries
  try {
    entries = await fs.readdir(toExtended(dirPath), { withFileTypes: true })
  } catch (err) {
    const info = fsErrorInfo(err)
    record(
      out.failures,
      { path: dirPath, code: info.code, message: `无法读取目录：${info.message}` },
      () => {
        out.failedCount++
      }
    )
    return
  }

  for (const ent of entries) {
    if (ctx.signal.aborted) {
      out.cancelled = true
      return
    }
    const full = path.win32.join(dirPath, ent.name)
    if (ent.isSymbolicLink()) {
      record(out.skipped, { path: full, code: 'E_REPARSE', message: '符号链接/目录联接，已跳过' }, () => {
        out.skippedCount++
      })
      continue
    }
    if (ent.isDirectory()) {
      await deleteTreeSafe(full, ctx, out, true)
    } else if (ent.isFile()) {
      await deleteFileSafe(full, ctx, out)
    } else {
      record(out.skipped, { path: full, code: 'E_SPECIAL', message: '特殊文件，已跳过' }, () => {
        out.skippedCount++
      })
    }
  }

  if (removeRoot && !ctx.signal.aborted) {
    try {
      await fs.rmdir(toExtended(dirPath))
      out.deletedDirs++
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        const info = fsErrorInfo(err)
        record(
          out.failures,
          { path: dirPath, code: info.code, message: `无法删除目录：${info.message}` },
          () => {
            out.failedCount++
          }
        )
      }
    }
  }
}

/** 删除一组文件（用于非递归的通配规则） */
export async function deleteFileList(
  files: string[],
  ctx: DeleteContext,
  out: DeleteOutcome
): Promise<void> {
  for (const file of files) {
    if (ctx.signal.aborted) {
      out.cancelled = true
      return
    }
    await deleteFileSafe(file, ctx, out)
  }
}
