import type { AnalyzeScanResult, Settings, TopFile, TreeNode, TreemapNode } from '@shared/types'
import { normKey } from '../core/paths'
import { defaultConcurrency } from '../core/semaphore'
import type { TaskContext } from '../core/task-manager'
import { walkTree } from '../fs/walker'
import { TreeStore } from './tree-store'

const TOP_LIMIT = 500

const IGNORED_DIRS = new Set(['$recycle.bin', 'system volume information'])
const IGNORED_FILES = new Set([
  'pagefile.sys',
  'hiberfil.sys',
  'swapfile.sys',
  'dumpstack.log.tmp'
])

class TopFileCollector {
  private items: TopFile[] = []

  constructor(private readonly limit: number) {}

  push(file: TopFile): void {
    this.items.push(file)
    if (this.items.length > this.limit * 2) {
      this.items.sort((a, b) => b.size - a.size)
      this.items.length = this.limit
    }
  }

  result(): TopFile[] {
    this.items.sort((a, b) => b.size - a.size)
    return this.items.slice(0, this.limit)
  }
}

export interface AnalyzeSession {
  taskId: string
  rootPath: string
  store: TreeStore
  topFiles: TopFile[]
  skipped: number
  elapsedMs: number
  createdAt: number
}

const sessions = new Map<string, AnalyzeSession>()

function putSession(session: AnalyzeSession): void {
  sessions.set(session.taskId, session)
  if (sessions.size <= 3) return
  const sorted = [...sessions.values()].sort((a, b) => a.createdAt - b.createdAt)
  while (sessions.size > 3 && sorted.length) {
    const oldest = sorted.shift()
    if (oldest) sessions.delete(oldest.taskId)
  }
}

export function getAnalyzeSession(taskId: string): AnalyzeSession | undefined {
  return sessions.get(taskId)
}

export function queryChildren(
  taskId: string,
  dirPath: string,
  offset: number,
  limit: number
): { items: TreeNode[]; total: number } {
  const session = sessions.get(taskId)
  if (!session) return { items: [], total: 0 }
  return session.store.childrenPage(dirPath, offset, limit)
}

export function queryTreemap(
  taskId: string,
  dirPath: string,
  depth: number,
  maxChildren: number
): TreemapNode | null {
  const session = sessions.get(taskId)
  if (!session) return null
  return session.store.buildTreemap(dirPath, depth, maxChildren)
}

export function queryTopFiles(taskId: string, limit: number): TopFile[] {
  const session = sessions.get(taskId)
  if (!session) return []
  return session.topFiles.slice(0, Math.min(limit, TOP_LIMIT))
}

export async function scanAnalyze(
  ctx: TaskContext,
  rootPath: string,
  settings: Settings,
  expectedBytes?: number
): Promise<AnalyzeScanResult> {
  const startedAt = Date.now()
  const store = new TreeStore(rootPath)
  const topFiles = new TopFileCollector(TOP_LIMIT)
  let skipped = 0
  let lastPath = rootPath

  const report = (currentPath: string): void => {
    const percent =
      expectedBytes && expectedBytes > 0
        ? Math.min(99, (store.totalBytes / expectedBytes) * 100)
        : null
    ctx.progress({
      phase: '扫描目录',
      percent,
      done: store.totalFiles,
      bytesDone: store.totalBytes,
      bytesTotal: expectedBytes ?? null,
      currentPath
    })
  }

  await walkTree(rootPath, {
    signal: ctx.signal,
    concurrency: defaultConcurrency(settings.slowMode),
    ignore: (name, _full, isDir) => {
      const lower = name.toLowerCase()
      if (isDir && IGNORED_DIRS.has(lower)) return 'system-dir'
      if (!isDir && IGNORED_FILES.has(lower)) return 'system-file'
      return null
    },
    onDir: (dir) => {
      store.ensureDir(dir.path, dir.name, dir.depth)
      store.countDir(dir.path)
      lastPath = dir.path
      report(lastPath)
    },
    onFile: (file) => {
      store.addFile(file.path, file.size)
      topFiles.push({
        path: file.path,
        name: file.name,
        size: file.size,
        mtimeMs: file.mtimeMs
      })
      lastPath = file.path
      report(lastPath)
    },
    onSkip: () => {
      skipped++
    },
    onError: () => {
      skipped++
    }
  })

  ctx.checkAbort()

  const top = topFiles.result()
  const session: AnalyzeSession = {
    taskId: ctx.taskId,
    rootPath,
    store,
    topFiles: top,
    skipped,
    elapsedMs: Date.now() - startedAt,
    createdAt: Date.now()
  }
  putSession(session)

  return {
    taskId: ctx.taskId,
    rootPath,
    totalBytes: store.totalBytes,
    totalFiles: store.totalFiles,
    totalDirs: store.totalDirs,
    skipped,
    truncated: store.truncated,
    elapsedMs: session.elapsedMs,
    root: store.toTreeNode(store.root),
    topFiles: top
  }
}

/** 判断路径是否属于当前分析会话（供 IPC 校验） */
export function isKnownAnalyzePath(taskId: string, p: string): boolean {
  const session = sessions.get(taskId)
  if (!session) return false
  return session.store.nodes.has(normKey(p))
}
