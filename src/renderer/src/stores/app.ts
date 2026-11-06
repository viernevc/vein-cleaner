import { unwrap } from '../lib/ipc'
import { applyThemeClass, resolveScheme, resolveTheme } from '@composables/useTheme'
import type { AppState, ResumeTask, SetLogDirResult, Settings, ThemeMode } from '@shared/types'

const FALLBACK_SETTINGS: Settings = {
  theme: 'light',
  slowMode: false,
  downloadAgeDays: 30,
  minDuplicateSize: 1024 * 1024,
  logDir: '',
  excludeDirs: ['node_modules', '.git'],
  lastCleanAt: null,
  lastCleanBytes: 0
}

export const useAppStore = defineStore('app', () => {
  const ready = ref(false)
  const version = ref('')
  const isAdmin = ref(false)
  const elevated = ref(false)
  const platform = ref('win32')
  const userDataPath = ref('')
  const logsPath = ref('')
  const settings = ref<Settings>({ ...FALLBACK_SETTINGS })
  const resumeTask = ref<ResumeTask | null>(null)

  async function init(): Promise<void> {
    const state: AppState = await unwrap(window.vein.app.state())
    version.value = state.version
    isAdmin.value = state.isAdmin
    elevated.value = state.elevated
    platform.value = state.platform
    userDataPath.value = state.userDataPath
    logsPath.value = state.logsPath
    settings.value = state.settings
    resumeTask.value = state.resumeTask
    applyThemeClass(resolveTheme(state.settings.theme))
    ready.value = true
  }

  async function updateSettings(patch: Partial<Settings>): Promise<void> {
    const next = await unwrap(window.vein.settings.update(patch))
    settings.value = next
    applyThemeClass(resolveTheme(next.theme))
  }

  async function setTheme(theme: ThemeMode): Promise<void> {
    await updateSettings({ theme })
  }

  async function setLogDir(dir: string): Promise<SetLogDirResult> {
    const result = await unwrap(window.vein.settings.setLogDir({ dir }))
    settings.value = result.settings
    logsPath.value = result.logsPath
    return result
  }

  async function ackResume(): Promise<void> {
    if (!resumeTask.value) return
    const token = resumeTask.value.token
    await unwrap(window.vein.app.resumeAck({ token }))
    resumeTask.value = null
  }

  async function relaunchElevated(ruleIds: string[]): Promise<{ ok: boolean; error?: string }> {
    return unwrap(window.vein.app.relaunchElevated({ ruleIds }))
  }

  function effectiveTheme(): 'dark' | 'light' {
    return resolveScheme(settings.value.theme)
  }

  return {
    ready,
    version,
    isAdmin,
    elevated,
    platform,
    userDataPath,
    logsPath,
    settings,
    resumeTask,
    init,
    updateSettings,
    setTheme,
    setLogDir,
    ackResume,
    relaunchElevated,
    effectiveTheme
  }
})
