import { app } from 'electron'
import path from 'node:path'
import type { Settings, ThemeMode } from '@shared/types'
import { JsonStore } from './json-store'

export const DEFAULT_SETTINGS: Settings = {
  theme: 'light',
  slowMode: false,
  downloadAgeDays: 30,
  minDuplicateSize: 1024 * 1024,
  excludeDirs: ['node_modules', '.git', '$Recycle.Bin', 'System Volume Information'],
  logDir: '',
  lastCleanAt: null,
  lastCleanBytes: 0
}

let store: JsonStore<Settings> | null = null

function getStore(): JsonStore<Settings> {
  if (!store) {
    store = new JsonStore(path.join(app.getPath('userData'), 'settings.json'), DEFAULT_SETTINGS)
  }
  return store
}

export function getSettings(): Settings {
  return getStore().read()
}

const THEMES: ThemeMode[] = ['dark', 'light', 'green', 'system']

/** 护眼绿按浅色方案同步系统原生主题 */
export function nativeThemeSource(theme: ThemeMode): 'system' | 'light' | 'dark' {
  if (theme === 'dark') return 'dark'
  if (theme === 'system') return 'system'
  return 'light'
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const current = getSettings()
  const next: Settings = { ...current }

  if (patch.theme && THEMES.includes(patch.theme)) next.theme = patch.theme
  if (typeof patch.slowMode === 'boolean') next.slowMode = patch.slowMode
  if (typeof patch.downloadAgeDays === 'number' && Number.isFinite(patch.downloadAgeDays)) {
    next.downloadAgeDays = Math.min(3650, Math.max(1, Math.round(patch.downloadAgeDays)))
  }
  if (typeof patch.minDuplicateSize === 'number' && Number.isFinite(patch.minDuplicateSize)) {
    next.minDuplicateSize = Math.min(1024 * 1024 * 1024, Math.max(0, Math.round(patch.minDuplicateSize)))
  }
  if (Array.isArray(patch.excludeDirs)) {
    next.excludeDirs = patch.excludeDirs
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 50)
  }
  if (typeof patch.logDir === 'string') {
    next.logDir = patch.logDir.trim().slice(0, 1024)
  }
  if (patch.lastCleanAt === null || typeof patch.lastCleanAt === 'number') next.lastCleanAt = patch.lastCleanAt
  if (typeof patch.lastCleanBytes === 'number') next.lastCleanBytes = Math.max(0, patch.lastCleanBytes)

  getStore().write(next)
  return next
}
