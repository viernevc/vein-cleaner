/** 主进程与渲染进程共享的纯类型定义（不得引入 Node/Electron API） */

/** green 为护眼绿浅色主题 */
export type ThemeMode = 'dark' | 'light' | 'green' | 'system'

export interface Settings {
  theme: ThemeMode
  slowMode: boolean
  downloadAgeDays: number
  minDuplicateSize: number
  excludeDirs: string[]
  /** 自定义日志目录；空字符串表示自动（安装目录 logs，不可写时回退 userData） */
  logDir: string
  lastCleanAt: number | null
  lastCleanBytes: number
}

export interface SetLogDirResult {
  settings: Settings
  logsPath: string
  moved: string[]
  failed: string[]
}

export interface AppErrorInfo {
  code: string
  message: string
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: AppErrorInfo }

/* ---------------------------------- 任务 ---------------------------------- */

export type TaskKind = 'clean.scan' | 'clean.run' | 'analyze.scan' | 'dup.scan' | 'dup.delete'
export type TaskState = 'queued' | 'running' | 'cancelling' | 'done' | 'error' | 'cancelled'

export interface TaskSnapshot {
  taskId: string
  kind: TaskKind
  state: TaskState
  phase: string
  percent: number | null
  done: number
  total: number | null
  bytesDone: number
  bytesTotal: number | null
  currentPath?: string
  startedAt: number
  endedAt?: number
}

export type TaskEvent =
  | { type: 'state'; taskId: string; state: TaskState; phase?: string }
  | {
      type: 'progress'
      taskId: string
      phase: string
      percent: number | null
      done: number
      total: number | null
      bytesDone: number
      bytesTotal: number | null
      currentPath?: string
    }
  | { type: 'done'; taskId: string; result: unknown }
  | { type: 'error'; taskId: string; error: AppErrorInfo }
  | { type: 'cancelled'; taskId: string }

/* --------------------------------- 清理规则 -------------------------------- */

export type RuleGroup = 'system' | 'browser' | 'recycle' | 'user'
export type Safety = 'low' | 'medium' | 'high'
export type RuleSpecial = 'recycle-bin' | 'windows-update' | 'font-cache'

export interface RuleMeta {
  id: string
  group: RuleGroup
  name: string
  description: string
  safety: Safety
  adminRequired: boolean
  defaultEnabled: boolean
  special?: RuleSpecial
  lockHint?: string
}

export type RuleScanStatus = 'ok' | 'admin-skipped' | 'process-running' | 'error'

export interface RuleScanSummary {
  ruleId: string
  bytes: number
  files: number
  dirs: number
  status: RuleScanStatus
  message?: string
  truncated: boolean
  elapsedMs: number
  skipped: { code: string; count: number }
}

export interface CleanScanResult {
  scanTaskId: string
  categories: RuleScanSummary[]
  totalBytes: number
  totalFiles: number
  confirmToken: string
  isAdmin: boolean
}

export interface CleanEntry {
  path: string
  size: number
  mtimeMs: number
  kind: 'file' | 'dir'
}

export interface FailureEntry {
  path: string
  code: string
  message: string
}

export interface CleanRuleReport {
  ruleId: string
  deletedBytes: number
  deletedFiles: number
  deletedDirs: number
  failures: number
  skipped: number
}

export interface CleanReport {
  taskId: string
  deletedBytes: number
  deletedFiles: number
  deletedDirs: number
  perRule: CleanRuleReport[]
  failures: FailureEntry[]
  skipped: FailureEntry[]
  cancelled: boolean
  elapsedMs: number
}

/* --------------------------------- 空间分析 -------------------------------- */

export interface DriveInfo {
  letter: string
  name: string
  label: string
  fs: string
  total: number
  free: number
}

export interface TreeNode {
  path: string
  name: string
  size: number
  fileCount: number
  dirCount: number
  hasChildren: boolean
}

export interface TreemapNode {
  name: string
  path: string
  value: number
  children?: TreemapNode[]
}

export interface TopFile {
  path: string
  name: string
  size: number
  mtimeMs: number
}

export interface AnalyzeScanResult {
  taskId: string
  rootPath: string
  totalBytes: number
  totalFiles: number
  totalDirs: number
  skipped: number
  truncated: boolean
  elapsedMs: number
  root: TreeNode
  topFiles: TopFile[]
}

/* -------------------------------- 重复文件 -------------------------------- */

export type KeepRule = 'newest' | 'oldest' | 'shortest-path' | 'first' | 'manual'

export interface DuplicateGroupSummary {
  id: string
  size: number
  count: number
  wasted: number
}

export interface DuplicateFile {
  id: string
  path: string
  name: string
  mtimeMs: number
  ctimeMs: number
}

export interface DuplicateGroupDetail {
  id: string
  size: number
  wasted: number
  files: DuplicateFile[]
}

export interface DupScanResult {
  taskId: string
  roots: string[]
  totalGroups: number
  totalFiles: number
  wastedBytes: number
  candidates: number
  truncated: boolean
  elapsedMs: number
  groups: DuplicateGroupSummary[]
}

export interface DupSelection {
  groupId: string
  fileIds: string[]
}

export interface DupDeleteResult {
  trashed: number
  trashedBytes: number
  failures: FailureEntry[]
}

/* --------------------------------- 应用状态 -------------------------------- */

export interface ResumeTask {
  kind: 'clean'
  ruleIds: string[]
  token: string
  createdAt: number
}

export interface AppState {
  version: string
  isAdmin: boolean
  elevated: boolean
  theme: ThemeMode
  settings: Settings
  userDataPath: string
  logsPath: string
  resumeTask: ResumeTask | null
  platform: string
}

/* --------------------------------- preload -------------------------------- */

export interface Paged<T> {
  items: T[]
  total: number
}

export interface VeinApi {
  readonly initialTheme: string
  app: {
    state(): Promise<IpcResult<AppState>>
    relaunchElevated(payload: { ruleIds: string[] }): Promise<IpcResult<{ ok: boolean; error?: string }>>
    resumeAck(payload: { token: string }): Promise<IpcResult<{ ok: boolean }>>
    showItem(payload: { path: string; mode: 'reveal' | 'open' }): Promise<IpcResult<{ ok: boolean }>>
    openExternal(payload: { url: string }): Promise<IpcResult<{ ok: boolean }>>
  }
  rules: {
    list(): Promise<IpcResult<RuleMeta[]>>
  }
  settings: {
    get(): Promise<IpcResult<Settings>>
    update(payload: Partial<Settings>): Promise<IpcResult<Settings>>
    setLogDir(payload: { dir: string }): Promise<IpcResult<SetLogDirResult>>
  }
  clean: {
    scan(payload: { ruleIds: string[] }): Promise<IpcResult<{ taskId: string }>>
    run(payload: { scanTaskId: string; ruleIds: string[]; confirmToken: string }): Promise<IpcResult<{ taskId: string }>>
    entries(payload: {
      scanTaskId: string
      ruleId: string
      offset: number
      limit: number
      sort: 'size' | 'path'
    }): Promise<IpcResult<Paged<CleanEntry>>>
    report(payload: { taskId: string }): Promise<IpcResult<CleanReport>>
  }
  analyze: {
    drives(): Promise<IpcResult<DriveInfo[]>>
    scan(payload: { rootPath: string }): Promise<IpcResult<{ taskId: string }>>
    children(payload: {
      taskId: string
      path: string
      offset: number
      limit: number
    }): Promise<IpcResult<Paged<TreeNode>>>
    treemap(payload: { taskId: string; path: string; depth: number; maxChildren: number }): Promise<IpcResult<TreemapNode>>
    topFiles(payload: { taskId: string; limit: number }): Promise<IpcResult<TopFile[]>>
  }
  duplicates: {
    scan(payload: { roots: string[]; minSize: number; excludeDirs: string[] }): Promise<IpcResult<{ taskId: string }>>
    groups(payload: {
      taskId: string
      offset: number
      limit: number
      sort: 'wasted' | 'size' | 'count'
    }): Promise<IpcResult<Paged<DuplicateGroupSummary>>>
    group(payload: { taskId: string; groupId: string }): Promise<IpcResult<DuplicateGroupDetail>>
    remove(payload: { taskId: string; selections: DupSelection[] }): Promise<IpcResult<DupDeleteResult>>
  }
  tasks: {
    cancel(payload: { taskId: string }): Promise<IpcResult<{ ok: boolean }>>
    snapshot(): Promise<IpcResult<TaskSnapshot[]>>
    onEvent(cb: (event: TaskEvent) => void): () => void
  }
  window: {
    control(action: 'minimize' | 'toggle-maximize' | 'close'): Promise<IpcResult<{ ok: boolean }>>
    onMaximized(cb: (maximized: boolean) => void): () => void
  }
  dialog: {
    pickFolder(payload?: { defaultPath?: string }): Promise<IpcResult<{ path?: string }>>
  }
}
