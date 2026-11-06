import fs from 'node:fs/promises'
import type { Settings } from '@shared/types'
import { expandEnv, expandWildcard, isProtectedPath, matchPattern, toExtended } from '../core/paths'
import type { CleanRule } from './rules'

export interface ResolvedTarget {
  root: string
  recursive: boolean
  filePatterns?: string[]
  excludePatterns?: string[]
  minAgeMs?: number
  removeRoot: boolean
}

const DAY = 24 * 60 * 60 * 1000

/** 展开规则目标为真实目录；不存在、符号链接、受保护目录一律跳过 */
export async function resolveRuleTargets(
  rule: CleanRule,
  settings: Settings
): Promise<ResolvedTarget[]> {
  const resolved: ResolvedTarget[] = []

  for (const target of rule.targets) {
    const expanded = expandEnv(target.template)
    if (!expanded) continue

    const roots = target.template.includes('*')
      ? await expandWildcard(expanded)
      : [expanded]

    for (const root of roots) {
      const stat = await fs.lstat(toExtended(root)).catch(() => null)
      if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) continue
      if (isProtectedPath(root)) continue
      const minAgeDays = target.minAgeDays
        ? target.minAgeDays
        : target.ageFromSettings
          ? settings.downloadAgeDays
          : undefined
      resolved.push({
        root,
        recursive: target.recursive,
        filePatterns: target.filePatterns,
        excludePatterns: target.excludePatterns,
        minAgeMs: minAgeDays ? minAgeDays * DAY : undefined,
        removeRoot: !!target.removeRoot
      })
    }
  }

  return resolved
}

export function isFileWanted(
  name: string,
  mtimeMs: number,
  target: ResolvedTarget,
  now = Date.now()
): boolean {
  if (target.minAgeMs && now - mtimeMs < target.minAgeMs) return false
  if (target.excludePatterns?.length) {
    if (target.excludePatterns.some((p) => matchPattern(name, p))) return false
  }
  if (target.filePatterns?.length) {
    return target.filePatterns.some((p) => matchPattern(name, p))
  }
  return true
}
