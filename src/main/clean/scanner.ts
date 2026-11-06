import fs from 'node:fs/promises'
import path from 'node:path'
import type { CleanEntry, RuleScanStatus, RuleScanSummary, Settings } from '@shared/types'
import { fsErrorInfo } from '../core/errors'
import { matchPattern, toExtended } from '../core/paths'
import { defaultConcurrency } from '../core/semaphore'
import type { TaskContext } from '../core/task-manager'
import { walkTree } from '../fs/walker'
import { isProcessRunning } from '../platform/processes'
import { getRecycleBinSize } from '../platform/recycle-bin'
import { isFileWanted, resolveRuleTargets } from './rule-resolver'
import type { CleanRule } from './rules'
import type { CleanEntryBucket } from './session'

const ENTRY_LIMIT = 1000

export interface CleanScanOutcome {
  summaries: RuleScanSummary[]
  entries: Map<string, CleanEntryBucket>
  totalBytes: number
  totalFiles: number
}

function emptySummary(
  ruleId: string,
  status: RuleScanStatus,
  message?: string
): RuleScanSummary {
  return {
    ruleId,
    bytes: 0,
    files: 0,
    dirs: 0,
    status,
    message,
    truncated: false,
    elapsedMs: 0,
    skipped: { code: '', count: 0 }
  }
}

async function scanRule(
  rule: CleanRule,
  ctx: TaskContext,
  settings: Settings,
  admin: boolean
): Promise<{ summary: RuleScanSummary; bucket: CleanEntryBucket }> {
  const started = Date.now()
  const bucket: CleanEntryBucket = { items: [], total: 0, truncated: false }

  if (rule.adminRequired && !admin) {
    return {
      summary: { ...emptySummary(rule.id, 'admin-skipped', '需要管理员权限'), elapsedMs: Date.now() - started },
      bucket
    }
  }

  if (rule.special === 'recycle-bin') {
    const size = await getRecycleBinSize()
    return {
      summary: {
        ...emptySummary(rule.id, 'ok', '清空后不可恢复'),
        bytes: size,
        elapsedMs: Date.now() - started
      },
      bucket
    }
  }

  const targets = await resolveRuleTargets(rule, settings)
  const concurrency = defaultConcurrency(settings.slowMode)
  let bytes = 0
  let files = 0
  let dirs = 0
  let skippedCount = 0
  let permissionIssue = false
  const now = Date.now()

  for (const target of targets) {
    ctx.checkAbort()

    if (target.recursive) {
      await walkTree(target.root, {
        signal: ctx.signal,
        concurrency,
        ignore: (name) =>
          target.excludePatterns?.some((p) => matchPattern(name, p)) ? 'excluded' : null,
        onFile: (file) => {
          if (!isFileWanted(file.name, file.mtimeMs, target, now)) return
          bytes += file.size
          files++
          bucket.total++
          if (bucket.items.length < ENTRY_LIMIT) {
            const entry: CleanEntry = {
              path: file.path,
              size: file.size,
              mtimeMs: file.mtimeMs,
              kind: 'file'
            }
            bucket.items.push(entry)
          } else {
            bucket.truncated = true
          }
          ctx.progress({ done: files, bytesDone: bytes, currentPath: file.path })
        },
        onDir: (dir) => {
          dirs++
          ctx.progress({ currentPath: dir.path })
        },
        onSkip: () => {
          skippedCount++
        },
        onError: (_p, code) => {
          skippedCount++
          if (code === 'EACCES' || code === 'EPERM') permissionIssue = true
        }
      })
    } else {
      let entries
      try {
        entries = await fs.readdir(toExtended(target.root), { withFileTypes: true })
      } catch (err) {
        skippedCount++
        const info = fsErrorInfo(err)
        if (info.code === 'EACCES' || info.code === 'EPERM') permissionIssue = true
        continue
      }
      for (const ent of entries) {
        if (ctx.aborted) break
        if (ent.isSymbolicLink()) {
          skippedCount++
          continue
        }
        if (ent.isDirectory()) {
          dirs++
          continue
        }
        if (!ent.isFile()) {
          skippedCount++
          continue
        }
        const full = path.win32.join(target.root, ent.name)
        try {
          const st = await fs.lstat(toExtended(full))
          if (st.isSymbolicLink() || !st.isFile()) {
            skippedCount++
            continue
          }
          if (!isFileWanted(ent.name, st.mtimeMs, target, now)) continue
          bytes += st.size
          files++
          bucket.total++
          if (bucket.items.length < ENTRY_LIMIT) {
            bucket.items.push({ path: full, size: st.size, mtimeMs: st.mtimeMs, kind: 'file' })
          } else {
            bucket.truncated = true
          }
          ctx.progress({ done: files, bytesDone: bytes, currentPath: full })
        } catch {
          skippedCount++
        }
      }
    }
  }

  let message: string | undefined
  if (rule.processGuard?.length && (await isProcessRunning(rule.processGuard))) {
    message = '检测到相关程序正在运行，部分缓存可能被占用'
  } else if (permissionIssue) {
    message = '部分目录无访问权限，已跳过'
  } else if (rule.lockHint && files > 0) {
    message = rule.lockHint
  }

  return {
    summary: {
      ruleId: rule.id,
      bytes,
      files,
      dirs,
      status: 'ok',
      message,
      truncated: bucket.truncated,
      elapsedMs: Date.now() - started,
      skipped: { code: skippedCount ? 'skipped' : '', count: skippedCount }
    },
    bucket
  }
}

export async function scanRules(
  rules: CleanRule[],
  ctx: TaskContext,
  settings: Settings,
  admin: boolean
): Promise<CleanScanOutcome> {
  const summaries: RuleScanSummary[] = []
  const entries = new Map<string, CleanEntryBucket>()
  let totalBytes = 0
  let totalFiles = 0

  for (let i = 0; i < rules.length; i++) {
    ctx.checkAbort()
    const rule = rules[i]
    ctx.progress({
      phase: `扫描：${rule.name}`,
      percent: null,
      done: totalFiles,
      bytesDone: totalBytes
    })

    const { summary, bucket } = await scanRule(rule, ctx, settings, admin)
    summaries.push(summary)
    entries.set(rule.id, bucket)
    totalBytes += summary.bytes
    totalFiles += summary.files

    ctx.progress({
      phase: `扫描：${rule.name}`,
      percent: ((i + 1) / rules.length) * 100,
      done: totalFiles,
      bytesDone: totalBytes
    })
  }

  ctx.checkAbort()

  return { summaries, entries, totalBytes, totalFiles }
}
