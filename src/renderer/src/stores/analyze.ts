import { unwrap } from '../lib/ipc'
import { useTaskStore } from '@store/tasks'
import type { AnalyzeScanResult, DriveInfo, TopFile, TreeNode, TreemapNode } from '@shared/types'

export interface Crumb {
  name: string
  path: string
}

export const useAnalyzeStore = defineStore('analyze', () => {
  const taskStore = useTaskStore()

  const drives = ref<DriveInfo[]>([])
  const scanning = ref(false)
  const scanningTaskId = ref<string | null>(null)
  const taskId = ref<string | null>(null)
  const result = ref<AnalyzeScanResult | null>(null)
  const currentPath = ref('')
  const treemap = ref<TreemapNode | null>(null)
  const children = ref<TreeNode[]>([])
  const childrenTotal = ref(0)
  const topFiles = ref<TopFile[]>([])
  const mode = ref<'treemap' | 'sunburst'>('treemap')
  const loadingView = ref(false)

  const progress = computed(() =>
    scanningTaskId.value ? taskStore.tasks[scanningTaskId.value] ?? null : null
  )

  const crumbs = computed<Crumb[]>(() => {
    const root = result.value?.rootPath ?? ''
    const current = currentPath.value
    if (!root || !current) return []
    const normalizedRoot = root.endsWith('\\') ? root : root + '\\'
    const items: Crumb[] = [{ name: root.replace(/\\$/, ''), path: normalizedRoot }]
    if (!current.startsWith(normalizedRoot)) return items
    const rel = current.slice(normalizedRoot.length).replace(/\\$/, '')
    if (!rel) return items
    let acc = normalizedRoot
    for (const part of rel.split('\\').filter(Boolean)) {
      acc = acc.endsWith('\\') ? acc + part : acc + '\\' + part
      items.push({ name: part, path: acc })
    }
    return items
  })

  async function loadDrives(): Promise<void> {
    drives.value = await unwrap(window.vein.analyze.drives())
  }

  async function scan(rootPath: string): Promise<void> {
    if (scanning.value) return
    scanning.value = true
    result.value = null
    taskId.value = null
    treemap.value = null
    children.value = []
    childrenTotal.value = 0
    topFiles.value = []
    try {
      const { taskId: id } = await unwrap(window.vein.analyze.scan({ rootPath }))
      scanningTaskId.value = id
      const res = await taskStore.waitFor<AnalyzeScanResult>(id)
      result.value = res
      taskId.value = id
      topFiles.value = res.topFiles
      currentPath.value = res.rootPath
      await loadView()
    } finally {
      scanning.value = false
      scanningTaskId.value = null
    }
  }

  async function loadView(): Promise<void> {
    if (!taskId.value || !currentPath.value) return
    loadingView.value = true
    try {
      const [tree, kids] = await Promise.all([
        unwrap(
          window.vein.analyze.treemap({
            taskId: taskId.value,
            path: currentPath.value,
            depth: 3,
            maxChildren: 120
          })
        ),
        unwrap(
          window.vein.analyze.children({
            taskId: taskId.value,
            path: currentPath.value,
            offset: 0,
            limit: 200
          })
        )
      ])
      treemap.value = tree
      children.value = kids.items
      childrenTotal.value = kids.total
    } finally {
      loadingView.value = false
    }
  }

  async function openPath(pathValue: string): Promise<void> {
    currentPath.value = pathValue
    await loadView()
  }

  function setMode(next: 'treemap' | 'sunburst'): void {
    mode.value = next
  }

  function reset(): void {
    result.value = null
    taskId.value = null
    currentPath.value = ''
    treemap.value = null
    children.value = []
    childrenTotal.value = 0
    topFiles.value = []
  }

  return {
    drives,
    scanning,
    scanningTaskId,
    taskId,
    result,
    currentPath,
    treemap,
    children,
    childrenTotal,
    topFiles,
    mode,
    loadingView,
    progress,
    crumbs,
    loadDrives,
    scan,
    loadView,
    openPath,
    setMode,
    reset
  }
})
