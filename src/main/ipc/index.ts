import { app, BrowserWindow, dialog, nativeTheme, shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { IPC } from '@shared/ipc'
import type {
  AppState,
  CleanEntry,
  CleanScanResult,
  CleanReport,
  DriveInfo,
  DuplicateGroupDetail,
  DuplicateGroupSummary,
  DupDeleteResult,
  DupScanResult,
  DupSelection,
  Paged,
  RuleMeta,
  SetLogDirResult,
  Settings,
  TaskSnapshot,
  TreeNode,
  TreemapNode,
  TopFile
} from '@shared/types'
import { AppError } from '../core/errors'
import { getSettings, nativeThemeSource, updateSettings } from '../core/settings'
import { tasks } from '../core/task-manager'
import { getLogsDir, resolveLogsDir, setLogsDir } from '../core/logger'
import { peekResumeTask, consumeResumeTask } from '../core/app-state'
import { toDisplay } from '../core/paths'
import { isAdmin } from '../platform/admin'
import { relaunchElevated } from '../platform/elevation'
import { getDrives } from '../platform/drives'
import { CLEAN_RULES, findRule, ruleMeta } from '../clean/rules'
import { scanRules } from '../clean/scanner'
import { runClean } from '../clean/cleaner'
import { getCleanSession, putCleanSession, type CleanSession } from '../clean/session'
import { getCleanReport, putCleanReport } from '../clean/reports'
import { scanAnalyze, queryChildren, queryTreemap, queryTopFiles, isKnownAnalyzePath } from '../analyze/analyzer'
import { scanDuplicates, listGroups, getGroup, removeDuplicates } from '../duplicates/indexer'
import {
  asEnum,
  asNumber,
  asOptionalString,
  asString,
  asStringArray,
  handle
} from './guard'

type WindowGetter = () => BrowserWindow | null

function applyTheme(settings: Settings): void {
  nativeTheme.themeSource = nativeThemeSource(settings.theme)
}

export function registerIpc(getWindow: WindowGetter): void {
  /* --------------------------------- 应用 --------------------------------- */
  handle<Record<string, never>, AppState>(IPC.appState, async () => {
    const admin = await isAdmin()
    const settings = getSettings()
    return {
      version: app.getVersion(),
      isAdmin: admin,
      elevated: admin && process.argv.includes('--elevated'),
      theme: settings.theme,
      settings,
      userDataPath: app.getPath('userData'),
      logsPath: getLogsDir() || path.join(app.getPath('userData'), 'logs'),
      resumeTask: peekResumeTask(),
      platform: process.platform
    }
  })

  handle<{ ruleIds?: unknown }, { ok: boolean; error?: string }>(
    IPC.appRelaunchElevated,
    async (input) => {
      if (process.platform !== 'win32') {
        throw new AppError('E_UNSUPPORTED', '仅支持 Windows')
      }
      const ids = asStringArray(input.ruleIds, 'ruleIds', 100).filter((id) => !!findRule(id))
      if (!ids.length) throw new AppError('E_INVALID_INPUT', '没有可续跑的清理项')
      return relaunchElevated(ids)
    }
  )

  handle<{ token?: unknown }, { ok: boolean }>(IPC.appResumeAck, (input) => {
    const token = asString(input.token, 'token', 128)
    return { ok: consumeResumeTask(token) }
  })

  handle<{ path?: unknown; mode?: unknown }, { ok: boolean }>(IPC.appShowItem, async (input) => {
    const raw = asString(input.path, 'path')
    const abs = path.win32.resolve(raw)
    const stat = await fs.lstat(abs).catch(() => null)
    if (!stat) throw new AppError('ENOENT', '文件或目录不存在')
    if (stat.isSymbolicLink()) throw new AppError('E_REPARSE', '不支持定位符号链接')
    const mode = asEnum(input.mode, 'mode', ['reveal', 'open'] as const, 'reveal')
    if (mode === 'open' && stat.isDirectory()) {
      const error = await shell.openPath(toDisplay(abs))
      if (error) throw new AppError('E_OPEN', error)
    } else {
      shell.showItemInFolder(toDisplay(abs))
    }
    return { ok: true }
  })

  handle<{ url?: unknown }, { ok: boolean }>(IPC.appOpenExternal, async (input) => {
    const raw = asString(input.url, 'url', 2048)
    let parsed: URL
    try {
      parsed = new URL(raw)
    } catch {
      throw new AppError('E_INVALID_INPUT', '链接格式非法')
    }
    if (parsed.protocol !== 'https:') {
      throw new AppError('E_FORBIDDEN', '仅允许打开 https 链接')
    }
    await shell.openExternal(parsed.toString())
    return { ok: true }
  })

  /* --------------------------------- 规则 --------------------------------- */
  handle<Record<string, never>, RuleMeta[]>(IPC.rulesList, () => CLEAN_RULES.map(ruleMeta))

  /* --------------------------------- 设置 --------------------------------- */
  handle<Record<string, never>, Settings>(IPC.settingsGet, () => getSettings())

  handle<Partial<Settings>, Settings>(IPC.settingsUpdate, (input) => {
    const next = updateSettings(input)
    applyTheme(next)
    return next
  })

  handle<{ dir?: unknown }, SetLogDirResult>(IPC.settingsSetLogDir, (input) => {
    const raw = typeof input.dir === 'string' ? input.dir.trim().slice(0, 1024) : ''
    let target: string

    if (raw) {
      const normalized = path.win32.normalize(raw)
      if (!path.win32.isAbsolute(normalized)) {
        throw new AppError('E_INVALID_INPUT', '日志目录必须是绝对路径')
      }
      target = normalized
    } else {
      target = resolveLogsDir(app.getPath('userData'))
    }

    const result = setLogsDir(target)
    if (!result.ok) {
      throw new AppError('E_LOG_DIR', result.error || '日志目录不可写')
    }

    const settings = updateSettings({ logDir: raw ? target : '' })
    return {
      settings,
      logsPath: result.dir,
      moved: result.moved,
      failed: result.failed
    }
  })

  /* ------------------------------- 一键清理 ------------------------------- */
  handle<{ ruleIds?: unknown }, { taskId: string }>(IPC.cleanScan, async (input) => {
    const ids =
      input.ruleIds === undefined
        ? CLEAN_RULES.map((r) => r.id)
        : asStringArray(input.ruleIds, 'ruleIds', 100)
    const rules = CLEAN_RULES.filter((r) => ids.includes(r.id))
    if (!rules.length) throw new AppError('E_INVALID_INPUT', '未选择可扫描的清理项')

    const admin = await isAdmin()
    const settings = getSettings()

    const taskId = tasks.start('clean.scan', async (ctx) => {
      const outcome = await scanRules(rules, ctx, settings, admin)
      const session: CleanSession = {
        taskId: ctx.taskId,
        createdAt: Date.now(),
        ruleIds: rules.map((r) => r.id),
        summaries: outcome.summaries,
        entries: outcome.entries,
        confirmToken: randomBytes(16).toString('hex')
      }
      putCleanSession(session)
      const result: CleanScanResult = {
        scanTaskId: ctx.taskId,
        categories: outcome.summaries,
        totalBytes: outcome.totalBytes,
        totalFiles: outcome.totalFiles,
        confirmToken: session.confirmToken,
        isAdmin: admin
      }
      return result
    })

    return { taskId }
  })

  handle<{ scanTaskId?: unknown; ruleIds?: unknown; confirmToken?: unknown }, { taskId: string }>(
    IPC.cleanRun,
    async (input) => {
      const scanTaskId = asString(input.scanTaskId, 'scanTaskId', 128)
      const session = getCleanSession(scanTaskId)
      if (!session) throw new AppError('E_SESSION', '扫描结果已过期，请重新扫描')
      const token = asString(input.confirmToken, 'confirmToken', 128)
      if (token !== session.confirmToken) throw new AppError('E_FORBIDDEN', '确认令牌无效')

      const requested = asStringArray(input.ruleIds, 'ruleIds', 100)
      const ruleIds = requested.filter((id) => session.ruleIds.includes(id))
      if (!ruleIds.length) throw new AppError('E_INVALID_INPUT', '未选择要清理的项目')

      const admin = await isAdmin()
      const settings = getSettings()
      const userData = app.getPath('userData')

      const taskId = tasks.start('clean.run', async (ctx) => {
        const report = await runClean(ctx, session, ruleIds, settings, admin, userData)
        putCleanReport(report)
        updateSettings({ lastCleanAt: Date.now(), lastCleanBytes: report.deletedBytes })
        return report
      })

      return { taskId }
    }
  )

  handle<
    { scanTaskId?: unknown; ruleId?: unknown; offset?: unknown; limit?: unknown; sort?: unknown },
    Paged<CleanEntry>
  >(IPC.cleanEntries, (input) => {
    const scanTaskId = asString(input.scanTaskId, 'scanTaskId', 128)
    const session = getCleanSession(scanTaskId)
    if (!session) throw new AppError('E_SESSION', '扫描结果已过期，请重新扫描')
    const ruleId = asString(input.ruleId, 'ruleId', 128)
    if (!session.ruleIds.includes(ruleId)) throw new AppError('E_INVALID_INPUT', '清理项不存在')
    const offset = Math.floor(asNumber(input.offset, 'offset', 0, 1_000_000, 0))
    const limit = Math.floor(asNumber(input.limit, 'limit', 1, 500, 100))
    const sort = asEnum(input.sort, 'sort', ['size', 'path'] as const, 'size')

    const bucket = session.entries.get(ruleId)
    if (!bucket) return { items: [], total: 0 }
    const items = [...bucket.items]
    if (sort === 'path') items.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'))
    else items.sort((a, b) => b.size - a.size)
    return { items: items.slice(offset, offset + limit), total: bucket.total }
  })

  handle<{ taskId?: unknown }, CleanReport>(IPC.cleanReport, (input) => {
    const taskId = asString(input.taskId, 'taskId', 128)
    const report = getCleanReport(taskId)
    if (!report) throw new AppError('E_NOT_FOUND', '清理报告不存在')
    return report
  })

  /* ------------------------------- 空间分析 ------------------------------- */
  handle<Record<string, never>, DriveInfo[]>(IPC.analyzeDrives, () => getDrives())

  handle<{ rootPath?: unknown }, { taskId: string }>(IPC.analyzeScan, async (input) => {
    const raw = asString(input.rootPath, 'rootPath', 512)
    const rootPath = path.win32.normalize(raw)
    if (!path.win32.isAbsolute(rootPath)) throw new AppError('E_INVALID_INPUT', '路径必须是绝对路径')
    const stat = await fs.lstat(rootPath).catch(() => null)
    if (!stat || !stat.isDirectory()) throw new AppError('ENOENT', '目录不存在或不可访问')
    if (stat.isSymbolicLink()) throw new AppError('E_REPARSE', '不支持分析符号链接目录')

    // 盘符根目录可用「已用容量」估算扫描进度；文件夹分析则保持不确定进度
    let expectedBytes: number | undefined
    if (/^[a-zA-Z]:\\$/.test(rootPath)) {
      try {
        const statfs = await fs.statfs(rootPath)
        const total = Number(statfs.bsize) * Number(statfs.blocks)
        const free = Number(statfs.bsize) * Number(statfs.bfree)
        expectedBytes = Math.max(0, total - free)
      } catch {
        expectedBytes = undefined
      }
    }

    const settings = getSettings()
    const taskId = tasks.start('analyze.scan', (ctx) =>
      scanAnalyze(ctx, rootPath, settings, expectedBytes)
    )
    return { taskId }
  })

  handle<
    { taskId?: unknown; path?: unknown; offset?: unknown; limit?: unknown },
    Paged<TreeNode>
  >(IPC.analyzeChildren, (input) => {
    const taskId = asString(input.taskId, 'taskId', 128)
    const dirPath = asString(input.path, 'path', 4096)
    if (!isKnownAnalyzePath(taskId, dirPath)) throw new AppError('E_INVALID_INPUT', '目录不属于本次扫描')
    const offset = Math.floor(asNumber(input.offset, 'offset', 0, 1_000_000, 0))
    const limit = Math.floor(asNumber(input.limit, 'limit', 1, 500, 100))
    return queryChildren(taskId, dirPath, offset, limit)
  })

  handle<
    { taskId?: unknown; path?: unknown; depth?: unknown; maxChildren?: unknown },
    TreemapNode
  >(IPC.analyzeTreemap, (input) => {
    const taskId = asString(input.taskId, 'taskId', 128)
    const dirPath = asString(input.path, 'path', 4096)
    if (!isKnownAnalyzePath(taskId, dirPath)) throw new AppError('E_INVALID_INPUT', '目录不属于本次扫描')
    const depth = Math.floor(asNumber(input.depth, 'depth', 1, 5, 3))
    const maxChildren = Math.floor(asNumber(input.maxChildren, 'maxChildren', 10, 300, 100))
    const tree = queryTreemap(taskId, dirPath, depth, maxChildren)
    if (!tree) throw new AppError('E_NOT_FOUND', '该目录未被扫描到')
    return tree
  })

  handle<{ taskId?: unknown; limit?: unknown }, TopFile[]>(IPC.analyzeTopFiles, (input) => {
    const taskId = asString(input.taskId, 'taskId', 128)
    const limit = Math.floor(asNumber(input.limit, 'limit', 1, 500, 200))
    return queryTopFiles(taskId, limit)
  })

  /* ------------------------------- 重复文件 ------------------------------- */
  handle<
    { roots?: unknown; minSize?: unknown; excludeDirs?: unknown },
    { taskId: string }
  >(IPC.dupScan, async (input) => {
    const roots = asStringArray(input.roots, 'roots', 10).map((r) => path.win32.normalize(r))
    if (!roots.length) throw new AppError('E_INVALID_INPUT', '请选择至少一个扫描目录')
    for (const root of roots) {
      if (!path.win32.isAbsolute(root)) throw new AppError('E_INVALID_INPUT', '扫描目录必须是绝对路径')
      const stat = await fs.lstat(root).catch(() => null)
      if (!stat || !stat.isDirectory()) throw new AppError('ENOENT', `目录不可访问：${root}`)
      if (stat.isSymbolicLink()) throw new AppError('E_REPARSE', `不支持扫描符号链接目录：${root}`)
    }
    const settings = getSettings()
    const minSize = Math.floor(asNumber(input.minSize, 'minSize', 0, 1024 * 1024 * 1024, settings.minDuplicateSize))
    const excludeDirs =
      input.excludeDirs === undefined
        ? settings.excludeDirs
        : asStringArray(input.excludeDirs, 'excludeDirs', 50)

    const taskId = tasks.start('dup.scan', (ctx) =>
      scanDuplicates(ctx, roots, minSize, excludeDirs, settings.slowMode)
    )
    return { taskId }
  })

  handle<
    { taskId?: unknown; offset?: unknown; limit?: unknown; sort?: unknown },
    Paged<DuplicateGroupSummary>
  >(IPC.dupGroups, (input) => {
    const taskId = asString(input.taskId, 'taskId', 128)
    const offset = Math.floor(asNumber(input.offset, 'offset', 0, 1_000_000, 0))
    const limit = Math.floor(asNumber(input.limit, 'limit', 1, 100, 20))
    const sort = asEnum(input.sort, 'sort', ['wasted', 'size', 'count'] as const, 'wasted')
    return listGroups(taskId, offset, limit, sort)
  })

  handle<{ taskId?: unknown; groupId?: unknown }, DuplicateGroupDetail>(
    IPC.dupGroup,
    (input) => {
      const taskId = asString(input.taskId, 'taskId', 128)
      const groupId = asString(input.groupId, 'groupId', 128)
      const group = getGroup(taskId, groupId)
      if (!group) throw new AppError('E_NOT_FOUND', '重复文件分组不存在')
      return group
    }
  )

  handle<{ taskId?: unknown; selections?: unknown }, DupDeleteResult>(
    IPC.dupRemove,
    async (input) => {
      const taskId = asString(input.taskId, 'taskId', 128)
      if (!Array.isArray(input.selections) || input.selections.length > 200) {
        throw new AppError('E_INVALID_INPUT', '删除选择非法')
      }
      const selections: DupSelection[] = input.selections.map((raw) => {
        const item = raw as { groupId?: unknown; fileIds?: unknown }
        return {
          groupId: asString(item.groupId, 'groupId', 128),
          fileIds: asStringArray(item.fileIds, 'fileIds', 500)
        }
      })
      return removeDuplicates(taskId, selections)
    }
  )

  /* --------------------------------- 任务 --------------------------------- */
  handle<{ taskId?: unknown }, { ok: boolean }>(IPC.taskCancel, (input) => {
    const taskId = asString(input.taskId, 'taskId', 128)
    return { ok: tasks.cancel(taskId) }
  })

  handle<Record<string, never>, TaskSnapshot[]>(IPC.taskSnapshot, () => tasks.snapshot())

  /* --------------------------------- 窗口 --------------------------------- */
  handle<{ action?: unknown }, { ok: boolean }>(IPC.winControl, (input) => {
    const win = getWindow()
    if (!win) throw new AppError('E_NO_WINDOW', '窗口不存在')
    const action = asEnum(
      input.action,
      'action',
      ['minimize', 'toggle-maximize', 'close'] as const,
      'minimize'
    )
    if (action === 'minimize') win.minimize()
    else if (action === 'toggle-maximize') {
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
    } else win.close()
    return { ok: true }
  })

  handle<{ defaultPath?: unknown }, { path?: string }>(
    IPC.dialogPickFolder,
    async (input) => {
      const win = getWindow()
      const defaultPath = asOptionalString(input.defaultPath, 'defaultPath', 1024)
      const result = win
        ? await dialog.showOpenDialog(win, {
            properties: ['openDirectory'],
            defaultPath
          })
        : await dialog.showOpenDialog({ properties: ['openDirectory'], defaultPath })
      if (result.canceled || !result.filePaths.length) return {}
      return { path: result.filePaths[0] }
    }
  )
}
