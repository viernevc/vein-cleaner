import fs from 'node:fs/promises'
import path from 'node:path'
import { shell } from 'electron'
import type {
  DupDeleteResult,
  DupScanResult,
  DupSelection,
  DuplicateFile,
  DuplicateGroupDetail,
  DuplicateGroupSummary,
  FailureEntry
} from '@shared/types'
import { fsErrorInfo } from '../core/errors'
import { toDisplay, toExtended } from '../core/paths'
import { defaultConcurrency } from '../core/semaphore'
import type { TaskContext } from '../core/task-manager'
import { walkTree } from '../fs/walker'
import { hashFiles, type HashFile } from './hash-pool'
import { getDupSession, groupSummary, putDupSession, type DupGroupRecord, type DupSession } from './session'

const MAX_CANDIDATES = 500000
const SUMMARY_PAGE = 200

interface Candidate {
  id: string
  path: string
  name: string
  size: number
  mtimeMs: number
}

export async function scanDuplicates(
  ctx: TaskContext,
  roots: string[],
  minSize: number,
  excludeDirs: string[],
  slowMode: boolean
): Promise<DupScanResult> {
  const startedAt = Date.now()
  const exclude = new Set(excludeDirs.map((s) => s.toLowerCase()))
  const candidates: Candidate[] = []
  let truncated = false
  let idSeq = 0

  ctx.progress({ phase: '枚举文件', percent: null, done: 0, bytesDone: 0 })

  for (const root of roots) {
    ctx.checkAbort()
    await walkTree(root, {
      signal: ctx.signal,
      concurrency: defaultConcurrency(slowMode),
      ignore: (name, _full, isDir) => (isDir && exclude.has(name.toLowerCase()) ? 'excluded' : null),
      onFile: (file) => {
        if (file.size < minSize || file.size === 0) return
        if (candidates.length >= MAX_CANDIDATES) {
          truncated = true
          return
        }
        candidates.push({
          id: `c${++idSeq}`,
          path: file.path,
          name: file.name,
          size: file.size,
          mtimeMs: file.mtimeMs
        })
        ctx.progress({
          phase: '枚举文件',
          percent: null,
          done: candidates.length,
          bytesDone: 0,
          currentPath: file.path
        })
      }
    })
  }

  ctx.checkAbort()

  if (!candidates.length) {
    const result = emptyResult(ctx.taskId, roots, startedAt, truncated, 0)
    putDupSession({ taskId: ctx.taskId, roots, groups: [], createdAt: Date.now() })
    return result
  }

  // 1. 按大小分组
  ctx.progress({ phase: '按大小分组', percent: 12, done: candidates.length, total: candidates.length })
  const bySize = new Map<number, Candidate[]>()
  for (const c of candidates) {
    const list = bySize.get(c.size)
    if (list) list.push(c)
    else bySize.set(c.size, [c])
  }
  const sizeGroups = [...bySize.values()].filter((g) => g.length > 1)

  // 2. 部分哈希
  const partialInput: HashFile[] = []
  for (const group of sizeGroups) {
    for (const c of group) partialInput.push({ id: c.id, path: c.path, size: c.size })
  }

  const partialResults = await hashFiles(
    partialInput,
    'partial',
    ctx.signal,
    (done, total) => {
      const percent = total ? 15 + (done / total) * 25 : 25
      ctx.progress({ phase: '部分哈希', percent, done, total })
    }
  )
  ctx.checkAbort()

  const byPartial = new Map<string, Candidate[]>()
  for (const c of candidates) {
    const hash = partialResults.get(c.id)
    if (!hash) continue
    const key = `${c.size}:${hash}`
    const list = byPartial.get(key)
    if (list) list.push(c)
    else byPartial.set(key, [c])
  }
  const partialGroups = [...byPartial.values()].filter((g) => g.length > 1)

  // 3. 完整哈希
  const fullInput: HashFile[] = []
  for (const group of partialGroups) {
    for (const c of group) fullInput.push({ id: c.id, path: c.path, size: c.size })
  }

  const fullResults = await hashFiles(
    fullInput,
    'full',
    ctx.signal,
    (done, total) => {
      const percent = total ? 40 + (done / total) * 55 : 95
      ctx.progress({ phase: '完整哈希', percent, done, total })
    }
  )
  ctx.checkAbort()

  const byFull = new Map<string, Candidate[]>()
  for (const c of partialGroups.flat()) {
    const hash = fullResults.get(c.id)
    if (!hash) continue
    const key = `${c.size}:${hash}`
    const list = byFull.get(key)
    if (list) list.push(c)
    else byFull.set(key, [c])
  }

  // 4. 组装分组
  let groupSeq = 0
  let fileSeq = 0
  const groups: DupGroupRecord[] = []
  for (const list of byFull.values()) {
    if (list.length < 2) continue
    const size = list[0].size
    const hash = fullResults.get(list[0].id) || ''
    groups.push({
      id: `g${++groupSeq}`,
      size,
      hash,
      files: list.map((c) => ({
        id: `f${++fileSeq}`,
        path: c.path,
        name: c.name,
        size: c.size,
        mtimeMs: c.mtimeMs,
        ctimeMs: c.mtimeMs
      }))
    })
  }
  groups.sort((a, b) => b.size * (b.files.length - 1) - a.size * (a.files.length - 1))

  const session: DupSession = {
    taskId: ctx.taskId,
    roots,
    groups,
    createdAt: Date.now()
  }
  putDupSession(session)

  const wastedBytes = groups.reduce((sum, g) => sum + g.size * (g.files.length - 1), 0)
  const totalFiles = groups.reduce((sum, g) => sum + g.files.length, 0)

  ctx.progress({ phase: '完成', percent: 100, done: fullInput.length, total: fullInput.length })

  return {
    taskId: ctx.taskId,
    roots,
    totalGroups: groups.length,
    totalFiles,
    wastedBytes,
    candidates: candidates.length,
    truncated,
    elapsedMs: Date.now() - startedAt,
    groups: groups.slice(0, SUMMARY_PAGE).map(groupSummary)
  }
}

function emptyResult(
  taskId: string,
  roots: string[],
  startedAt: number,
  truncated: boolean,
  candidates: number
): DupScanResult {
  return {
    taskId,
    roots,
    totalGroups: 0,
    totalFiles: 0,
    wastedBytes: 0,
    candidates,
    truncated,
    elapsedMs: Date.now() - startedAt,
    groups: []
  }
}

export function listGroups(
  taskId: string,
  offset: number,
  limit: number,
  sort: 'wasted' | 'size' | 'count'
): { items: DuplicateGroupSummary[]; total: number } {
  const session = getDupSession(taskId)
  if (!session) return { items: [], total: 0 }
  const summaries = session.groups.map(groupSummary)
  summaries.sort((a, b) => {
    if (sort === 'size') return b.size - a.size
    if (sort === 'count') return b.count - a.count
    return b.wasted - a.wasted
  })
  return {
    items: summaries.slice(offset, offset + limit),
    total: summaries.length
  }
}

export function getGroup(taskId: string, groupId: string): DuplicateGroupDetail | null {
  const session = getDupSession(taskId)
  const group = session?.groups.find((g) => g.id === groupId)
  if (!group) return null
  return {
    id: group.id,
    size: group.size,
    wasted: group.size * (group.files.length - 1),
    files: group.files.map(
      (f): DuplicateFile => ({
        id: f.id,
        path: f.path,
        name: f.name,
        mtimeMs: f.mtimeMs,
        ctimeMs: f.ctimeMs
      })
    )
  }
}

/** 删除选中文件（移入回收站），强制每组至少保留一个 */
export async function removeDuplicates(
  taskId: string,
  selections: DupSelection[]
): Promise<DupDeleteResult> {
  const session = getDupSession(taskId)
  const failures: FailureEntry[] = []
  let trashed = 0
  let trashedBytes = 0
  if (!session) return { trashed, trashedBytes, failures }

  for (const selection of selections) {
    const group = session.groups.find((g) => g.id === selection.groupId)
    if (!group) continue

    const selectedIds = new Set(selection.fileIds)
    const validFiles = group.files.filter((f) => selectedIds.has(f.id))
    if (!validFiles.length) continue

    if (validFiles.length >= group.files.length) {
      failures.push({ path: group.id, code: 'E_KEEP_ONE', message: '每组至少需要保留一个文件' })
      continue
    }

    for (const file of validFiles) {
      try {
        const st = await fs.lstat(toExtended(file.path))
        if (st.isSymbolicLink()) {
          failures.push({ path: file.path, code: 'E_REPARSE', message: '符号链接，已跳过' })
          continue
        }
        if (!st.isFile() || st.size !== file.size) {
          failures.push({ path: file.path, code: 'E_CHANGED', message: '文件在扫描后已变化，已跳过' })
          continue
        }
        await shell.trashItem(toDisplay(file.path))
        trashed++
        trashedBytes += file.size
        group.files = group.files.filter((f) => f.id !== file.id)
      } catch (err) {
        const info = fsErrorInfo(err)
        failures.push({
          path: file.path,
          code: 'E_RECYCLE',
          message: `无法移入回收站：${info.message}`
        })
      }
    }
  }

  session.groups = session.groups.filter((g) => g.files.length > 1)
  return { trashed, trashedBytes, failures }
}
