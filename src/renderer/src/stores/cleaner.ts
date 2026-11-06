import { unwrap } from '../lib/ipc'
import { useTaskStore } from '@store/tasks'
import type { CleanReport, CleanScanResult, RuleMeta, RuleScanSummary } from '@shared/types'

export const useCleanerStore = defineStore('cleaner', () => {
  const taskStore = useTaskStore()

  const rules = ref<RuleMeta[]>([])
  const selected = ref<string[]>([])
  const summaries = ref<RuleScanSummary[]>([])
  const scanTaskId = ref<string | null>(null)
  const confirmToken = ref('')
  const scanState = ref<'idle' | 'scanning' | 'done'>('idle')
  const scanningTaskId = ref<string | null>(null)
  const cleaningTaskId = ref<string | null>(null)
  const report = ref<CleanReport | null>(null)

  const isScanning = computed(() => scanState.value === 'scanning')
  const isCleaning = computed(() => cleaningTaskId.value !== null)

  const progress = computed(() => {
    const id = cleaningTaskId.value ?? scanningTaskId.value
    return id ? taskStore.tasks[id] ?? null : null
  })

  function summaryOf(ruleId: string): RuleScanSummary | undefined {
    return summaries.value.find((s) => s.ruleId === ruleId)
  }

  const selectedSummaries = computed(() =>
    selected.value
      .map((id) => summaryOf(id))
      .filter((s): s is RuleScanSummary => !!s && s.status === 'ok')
  )

  const selectedBytes = computed(() => selectedSummaries.value.reduce((sum, s) => sum + s.bytes, 0))
  const selectedFiles = computed(() => selectedSummaries.value.reduce((sum, s) => sum + s.files, 0))
  const adminBlockedCount = computed(
    () => selected.value.filter((id) => summaryOf(id)?.status === 'admin-skipped').length
  )

  async function loadRules(): Promise<void> {
    if (rules.value.length) return
    rules.value = await unwrap(window.vein.rules.list())
  }

  function initSelection(): void {
    if (selected.value.length) return
    selected.value = rules.value.filter((r) => r.defaultEnabled).map((r) => r.id)
  }

  function toggle(ruleId: string): void {
    const idx = selected.value.indexOf(ruleId)
    if (idx >= 0) selected.value.splice(idx, 1)
    else selected.value.push(ruleId)
  }

  function selectAll(): void {
    selected.value = rules.value.map((r) => r.id)
  }

  function clearSelection(): void {
    selected.value = []
  }

  async function scan(): Promise<void> {
    if (isScanning.value) return
    if (!selected.value.length) throw new Error('请至少选择一个清理项')
    scanState.value = 'scanning'
    summaries.value = []
    report.value = null
    scanTaskId.value = null
    confirmToken.value = ''

    const { taskId } = await unwrap(window.vein.clean.scan({ ruleIds: [...selected.value] }))
    scanningTaskId.value = taskId
    try {
      const result = await taskStore.waitFor<CleanScanResult>(taskId)
      summaries.value = result.categories
      scanTaskId.value = result.scanTaskId
      confirmToken.value = result.confirmToken
      scanState.value = 'done'
    } finally {
      scanningTaskId.value = null
      if (scanState.value === 'scanning') scanState.value = 'idle'
    }
  }

  async function clean(): Promise<CleanReport> {
    if (!scanTaskId.value || !confirmToken.value) throw new Error('请先扫描')
    const ruleIds = selectedSummaries.value
      .filter((s) => selected.value.includes(s.ruleId) && (s.bytes > 0 || s.files > 0))
      .map((s) => s.ruleId)
    if (!ruleIds.length) throw new Error('所选项目没有可清理的内容')

    const { taskId } = await unwrap(
      window.vein.clean.run({
        scanTaskId: scanTaskId.value,
        ruleIds,
        confirmToken: confirmToken.value
      })
    )
    cleaningTaskId.value = taskId
    try {
      const result = await taskStore.waitFor<CleanReport>(taskId)
      report.value = result
      return result
    } finally {
      cleaningTaskId.value = null
    }
  }

  function reset(): void {
    summaries.value = []
    scanTaskId.value = null
    confirmToken.value = ''
    scanState.value = 'idle'
    report.value = null
  }

  return {
    rules,
    selected,
    summaries,
    scanTaskId,
    confirmToken,
    scanState,
    scanningTaskId,
    cleaningTaskId,
    report,
    isScanning,
    isCleaning,
    progress,
    selectedSummaries,
    selectedBytes,
    selectedFiles,
    adminBlockedCount,
    summaryOf,
    loadRules,
    initSelection,
    toggle,
    selectAll,
    clearSelection,
    scan,
    clean,
    reset
  }
})
