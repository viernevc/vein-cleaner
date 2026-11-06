import { unwrap } from '../lib/ipc'
import { useTaskStore } from '@store/tasks'
import type {
  DupDeleteResult,
  DupScanResult,
  DuplicateGroupDetail,
  DuplicateGroupSummary,
  KeepRule
} from '@shared/types'

export const useDuplicatesStore = defineStore('duplicates', () => {
  const taskStore = useTaskStore()

  const roots = ref<string[]>([])
  const minSizeMb = ref(1)
  const groups = ref<DuplicateGroupSummary[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = 20
  const sort = ref<'wasted' | 'size' | 'count'>('wasted')
  const taskId = ref<string | null>(null)
  const scanningTaskId = ref<string | null>(null)
  const scanning = ref(false)
  const deleting = ref(false)
  const result = ref<DupScanResult | null>(null)
  const details = reactive<Record<string, DuplicateGroupDetail>>({})
  const selection = reactive<Record<string, string[]>>({})
  const keepRule = ref<KeepRule>('newest')
  const expanded = ref<string[]>([])

  const progress = computed(() =>
    scanningTaskId.value ? taskStore.tasks[scanningTaskId.value] ?? null : null
  )

  const selectedBytes = computed(() =>
    groups.value.reduce((sum, group) => {
      const ids = selection[group.id] ?? []
      return sum + ids.length * group.size
    }, 0)
  )

  const selectedCount = computed(() =>
    Object.values(selection).reduce((sum, ids) => sum + ids.length, 0)
  )

  async function scan(): Promise<void> {
    if (scanning.value) return
    if (!roots.value.length) throw new Error('请至少选择一个扫描目录')
    scanning.value = true
    groups.value = []
    total.value = 0
    taskId.value = null
    result.value = null
    page.value = 1
    clearDetails()
    try {
      const { taskId: id } = await unwrap(
        window.vein.duplicates.scan({
          roots: [...roots.value],
          minSize: Math.max(0, Math.round(minSizeMb.value * 1024 * 1024)),
          excludeDirs: []
        })
      )
      scanningTaskId.value = id
      const res = await taskStore.waitFor<DupScanResult>(id)
      result.value = res
      taskId.value = id
      groups.value = res.groups
      total.value = res.totalGroups
      await loadPage()
    } finally {
      scanning.value = false
      scanningTaskId.value = null
    }
  }

  async function loadPage(): Promise<void> {
    if (!taskId.value) return
    const res = await unwrap(
      window.vein.duplicates.groups({
        taskId: taskId.value,
        offset: (page.value - 1) * pageSize,
        limit: pageSize,
        sort: sort.value
      })
    )
    groups.value = res.items
    total.value = res.total
  }

  async function setPage(next: number): Promise<void> {
    page.value = next
    await loadPage()
  }

  async function setSort(next: 'wasted' | 'size' | 'count'): Promise<void> {
    sort.value = next
    page.value = 1
    await loadPage()
  }

  async function loadDetail(groupId: string): Promise<void> {
    if (!taskId.value || details[groupId]) return
    details[groupId] = await unwrap(
      window.vein.duplicates.group({ taskId: taskId.value, groupId })
    )
    applyKeep(groupId)
  }

  function applyKeep(groupId: string): void {
    const detail = details[groupId]
    if (!detail) return
    if (keepRule.value === 'manual') {
      selection[groupId] = []
      return
    }
    let keepId = detail.files[0]?.id
    if (keepRule.value === 'newest') {
      keepId = [...detail.files].sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.id
    } else if (keepRule.value === 'oldest') {
      keepId = [...detail.files].sort((a, b) => a.mtimeMs - b.mtimeMs)[0]?.id
    } else if (keepRule.value === 'shortest-path') {
      keepId = [...detail.files].sort((a, b) => a.path.length - b.path.length)[0]?.id
    }
    selection[groupId] = detail.files.filter((f) => f.id !== keepId).map((f) => f.id)
  }

  function setKeepRule(rule: KeepRule): void {
    keepRule.value = rule
    for (const groupId of Object.keys(details)) applyKeep(groupId)
  }

  function updateSelection(groupId: string, ids: string[]): boolean {
    const detail = details[groupId]
    if (detail && ids.length >= detail.files.length) {
      selection[groupId] = ids.slice(0, Math.max(0, detail.files.length - 1))
      keepRule.value = 'manual'
      return false
    }
    selection[groupId] = ids
    keepRule.value = 'manual'
    return true
  }

  function onExpandedChange(active: string[]): void {
    expanded.value = active
    for (const id of active) {
      void loadDetail(id)
    }
  }

  function clearDetails(): void {
    for (const key of Object.keys(details)) delete details[key]
    for (const key of Object.keys(selection)) delete selection[key]
    expanded.value = []
  }

  async function removeSelected(): Promise<DupDeleteResult> {
    if (!taskId.value) throw new Error('请先扫描')
    const selections = Object.entries(selection)
      .filter(([, ids]) => ids.length > 0)
      .map(([groupId, fileIds]) => ({ groupId, fileIds: [...fileIds] }))
    if (!selections.length) throw new Error('请选择要移入回收站的文件')

    deleting.value = true
    try {
      const res = await unwrap(window.vein.duplicates.remove({ taskId: taskId.value, selections }))
      clearDetails()
      await loadPage()
      if (!groups.value.length && page.value > 1) {
        page.value--
        await loadPage()
      }
      if (result.value) {
        result.value = {
          ...result.value,
          totalGroups: total.value,
          totalFiles: total.value === 0 ? 0 : Math.max(0, result.value.totalFiles - res.trashed),
          wastedBytes: Math.max(0, result.value.wastedBytes - res.trashedBytes),
          groups: groups.value
        }
      }
      return res
    } finally {
      deleting.value = false
    }
  }

  function reset(): void {
    groups.value = []
    total.value = 0
    taskId.value = null
    result.value = null
    page.value = 1
    clearDetails()
  }

  return {
    roots,
    minSizeMb,
    groups,
    total,
    page,
    pageSize,
    sort,
    taskId,
    scanningTaskId,
    scanning,
    deleting,
    result,
    details,
    selection,
    keepRule,
    expanded,
    progress,
    selectedBytes,
    selectedCount,
    scan,
    loadPage,
    setPage,
    setSort,
    loadDetail,
    setKeepRule,
    updateSelection,
    onExpandedChange,
    removeSelected,
    reset
  }
})
