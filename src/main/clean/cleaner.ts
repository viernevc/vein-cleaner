import fs from 'node:fs/promises'
import path from 'node:path'
import { shell } from 'electron'
import type {
  CleanReport,
  CleanRuleReport,
  FailureEntry,
  Settings
} from '@shared/types'
import { fsErrorInfo } from '../core/errors'
import { isInside, isProtectedPath, matchPattern, toDisplay, toExtended } from '../core/paths'
import { defaultConcurrency } from '../core/semaphore'
import type { TaskContext } from '../core/task-manager'
import {
  createOutcome,
  deleteFileList,
  deleteTreeSafe,
  type DeleteContext,
  type DeleteOutcome
} from '../fs/delete-safe'
import { walkTree } from '../fs/walker'
import { isProcessRunning } from '../platform/processes'
import { emptyRecycleBin } from '../platform/recycle-bin'
import { restoreServices, stopServices } from '../platform/services'
import { isFileWanted, resolveRuleTargets, type ResolvedTarget } from './rule-resolver'
import { findRule, type CleanRule } from './rules'
import type { CleanSession } from './session'

const SAMPLE_LIMIT = 200

function mergeOutcome(report: CleanReport, ruleId: string, out: DeleteOutcome): void {
  report.deletedBytes += out.deletedBytes
  report.deletedFiles += out.deletedFiles
  report.deletedDirs += out.deletedDirs

  const per = report.perRule.find((p) => p.ruleId === ruleId)
  if (per) {
    per.deletedBytes += out.deletedBytes
    per.deletedFiles += out.deletedFiles
    per.deletedDirs += out.deletedDirs
    per.failures += out.failedCount
    per.skipped += out.skippedCount
  }
  for (const item of out.failures) {
    if (report.failures.length < SAMPLE_LIMIT) report.failures.push(item)
  }
  for (const item of out.skipped) {
    if (report.skipped.length < SAMPLE_LIMIT) report.skipped.push(item)
  }
  if (out.cancelled) report.cancelled = true
}

async function listFilesInDir(target: ResolvedTarget): Promise<Array<{ path: string; size: number }>> {
  const files: Array<{ path: string; size: number }> = []
  let entries
  try {
    entries = await fs.readdir(toExtended(target.root), { withFileTypes: true })
  } catch {
    return files
  }
  const now = Date.now()
  for (const ent of entries) {
    if (!ent.isFile() || ent.isSymbolicLink()) continue
    const full = path.win32.join(target.root, ent.name)
    try {
      const st = await fs.lstat(toExtended(full))
      if (st.isSymbolicLink() || !st.isFile()) continue
      if (!isFileWanted(ent.name, st.mtimeMs, target, now)) continue
      files.push({ path: full, size: st.size })
    } catch {
      // 忽略单个文件错误
    }
  }
  return files
}

async function collectRecursiveFiles(
  target: ResolvedTarget,
  ctx: TaskContext,
  settings: Settings
): Promise<Array<{ path: string; size: number }>> {
  const files: Array<{ path: string; size: number }> = []
  const now = Date.now()
  await walkTree(target.root, {
    signal: ctx.signal,
    concurrency: defaultConcurrency(settings.slowMode),
    ignore: (name) =>
      target.excludePatterns?.some((p) => matchPattern(name, p)) ? 'excluded' : null,
    onFile: (file) => {
      if (!isFileWanted(file.name, file.mtimeMs, target, now)) return
      files.push({ path: file.path, size: file.size })
    }
  })
  return files
}

function needsFilteredDelete(target: ResolvedTarget): boolean {
  return (
    !!target.minAgeMs ||
    !!(target.filePatterns && target.filePatterns.length) ||
    !!(target.excludePatterns && target.excludePatterns.length)
  )
}

async function deleteTargetsPermanent(
  targets: ResolvedTarget[],
  ctx: TaskContext,
  settings: Settings,
  out: DeleteOutcome,
  progress: (bytes: number, files: number) => void
): Promise<void> {
  for (const target of targets) {
    if (ctx.aborted) {
      out.cancelled = true
      return
    }
    const dctx: DeleteContext = {
      signal: ctx.signal,
      root: target.root,
      onProgress: (bytes, files) => progress(bytes, files)
    }
    if (!target.recursive) {
      const files = await listFilesInDir(target)
      await deleteFileList(
        files.map((f) => f.path),
        dctx,
        out
      )
      continue
    }
    if (needsFilteredDelete(target)) {
      // 带时间/扩展名过滤的规则：逐文件判定，避免误删近期或不匹配的文件
      const files = await collectRecursiveFiles(target, ctx, settings)
      await deleteFileList(
        files.map((f) => f.path),
        dctx,
        out
      )
    } else {
      await deleteTreeSafe(target.root, dctx, out, target.removeRoot)
    }
  }
}

async function trashTargets(
  targets: ResolvedTarget[],
  ctx: TaskContext,
  settings: Settings,
  out: DeleteOutcome,
  progress: (bytes: number, files: number) => void
): Promise<void> {
  for (const target of targets) {
    if (ctx.aborted) {
      out.cancelled = true
      return
    }
    const files = target.recursive
      ? await collectRecursiveFiles(target, ctx, settings)
      : await listFilesInDir(target)

    for (const file of files) {
      if (ctx.aborted) {
        out.cancelled = true
        return
      }
      if (!isInside(file.path, target.root) || isProtectedPath(file.path)) {
        out.skippedCount++
        if (out.skipped.length < SAMPLE_LIMIT) {
          out.skipped.push({ path: file.path, code: 'E_GUARD', message: '路径未通过安全校验' })
        }
        continue
      }
      try {
        await shell.trashItem(toDisplay(file.path))
        out.deletedBytes += file.size
        out.deletedFiles++
        progress(out.deletedBytes, out.deletedFiles)
      } catch (err) {
        const info = fsErrorInfo(err)
        out.failedCount++
        if (out.failures.length < SAMPLE_LIMIT) {
          out.failures.push({
            path: file.path,
            code: 'E_RECYCLE',
            message: `无法移入回收站：${info.message}`
          })
        }
      }
    }
  }
}

function skippedEntry(rule: CleanRule, message: string): FailureEntry {
  return { path: rule.name, code: 'E_SKIPPED', message }
}

export async function runClean(
  ctx: TaskContext,
  session: CleanSession,
  selectedRuleIds: string[],
  settings: Settings,
  admin: boolean,
  userDataPath: string
): Promise<CleanReport> {
  const startedAt = Date.now()
  const report: CleanReport = {
    taskId: ctx.taskId,
    deletedBytes: 0,
    deletedFiles: 0,
    deletedDirs: 0,
    perRule: [],
    failures: [],
    skipped: [],
    cancelled: false,
    elapsedMs: 0
  }

  const selected = session.ruleIds.filter((id) => selectedRuleIds.includes(id))

  for (let i = 0; i < selected.length; i++) {
    const ruleId = selected[i]
    const rule = findRule(ruleId)
    if (!rule) continue

    ctx.checkAbort()
    ctx.progress({
      phase: `清理：${rule.name}`,
      percent: (i / Math.max(1, selected.length)) * 100,
      bytesDone: report.deletedBytes,
      done: report.deletedFiles
    })

    const per: CleanRuleReport = {
      ruleId,
      deletedBytes: 0,
      deletedFiles: 0,
      deletedDirs: 0,
      failures: 0,
      skipped: 0
    }
    report.perRule.push(per)

    if (rule.adminRequired && !admin) {
      per.skipped++
      if (report.skipped.length < SAMPLE_LIMIT) {
        report.skipped.push(skippedEntry(rule, '需要管理员权限，已跳过'))
      }
      continue
    }

    if (rule.processGuard?.length && (await isProcessRunning(rule.processGuard))) {
      per.skipped++
      if (report.skipped.length < SAMPLE_LIMIT) {
        report.skipped.push(skippedEntry(rule, '相关程序正在运行，已跳过该项'))
      }
      continue
    }

    if (rule.special === 'recycle-bin') {
      const summary = session.summaries.find((s) => s.ruleId === ruleId)
      const result = await emptyRecycleBin()
      if (result.ok) {
        const bytes = summary?.bytes ?? 0
        per.deletedBytes += bytes
        report.deletedBytes += bytes
      } else {
        per.failures++
        if (report.failures.length < SAMPLE_LIMIT) {
          report.failures.push({
            path: rule.name,
            code: 'E_RECYCLE',
            message: result.message || '清空回收站失败'
          })
        }
      }
      continue
    }

    const targets = await resolveRuleTargets(rule, settings)
    const outcome = createOutcome()
    const progress = (bytes: number, files: number): void => {
      ctx.progress({
        bytesDone: report.deletedBytes + bytes,
        done: report.deletedFiles + files
      })
    }

    if (rule.services?.length) {
      const states = await stopServices(rule.services, userDataPath)
      try {
        await deleteTargetsPermanent(targets, ctx, settings, outcome, progress)
      } finally {
        await restoreServices(states, userDataPath)
      }
    } else if (rule.deleteMode === 'recycle') {
      await trashTargets(targets, ctx, settings, outcome, progress)
    } else {
      await deleteTargetsPermanent(targets, ctx, settings, outcome, progress)
    }

    mergeOutcome(report, ruleId, outcome)
  }

  report.elapsedMs = Date.now() - startedAt
  report.cancelled = report.cancelled || ctx.aborted
  return report
}
