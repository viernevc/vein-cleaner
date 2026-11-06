<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Lock, Search } from '@element-plus/icons-vue'
import { useAppStore } from '@store/app'
import { useCleanerStore } from '@store/cleaner'
import { useTaskStore } from '@store/tasks'
import { errorText, unwrap } from '../lib/ipc'
import type { CleanEntry, RuleMeta } from '@shared/types'
import { formatBytes, formatNumber, formatTime } from '@shared/format'

const appStore = useAppStore()
const cleanerStore = useCleanerStore()
const taskStore = useTaskStore()

type GroupKey = 'all' | 'system' | 'browser' | 'recycle' | 'user'
const activeGroup = ref<GroupKey>('all')
const groupOptions: Array<{ value: GroupKey; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'system', label: '系统' },
  { value: 'browser', label: '浏览器' },
  { value: 'recycle', label: '回收站' },
  { value: 'user', label: '用户文件' }
]

const filteredRules = computed(() =>
  activeGroup.value === 'all'
    ? cleanerStore.rules
    : cleanerStore.rules.filter((rule) => rule.group === activeGroup.value)
)

const showReport = ref(false)
const resumeNotice = ref(false)

const detail = reactive({
  visible: false,
  rule: null as RuleMeta | null,
  items: [] as CleanEntry[],
  total: 0,
  offset: 0,
  limit: 50,
  sort: 'size' as 'size' | 'path',
  loading: false
})

onMounted(async () => {
  try {
    await cleanerStore.loadRules()
    cleanerStore.initSelection()
  } catch (err) {
    ElMessage.error(errorText(err))
  }

  if (appStore.resumeTask && appStore.resumeTask.kind === 'clean') {
    resumeNotice.value = true
    cleanerStore.selected = [...appStore.resumeTask.ruleIds]
    try {
      await appStore.ackResume()
    } catch {
      // 忽略确认失败
    }
    await startScan(true)
  }
})

async function startScan(autoClean = false): Promise<void> {
  try {
    await cleanerStore.scan()
    if (autoClean && cleanerStore.selectedSummaries.length) {
      await doClean(true)
    }
  } catch (err) {
    if (errorText(err) !== '任务已取消') ElMessage.error(errorText(err))
  }
}

async function doClean(auto = false): Promise<void> {
  if (!cleanerStore.selectedSummaries.length) {
    ElMessage.warning('没有可清理的内容')
    return
  }

  if (!auto) {
    const highRisk = cleanerStore.selectedSummaries.some((summary) => {
      const rule = cleanerStore.rules.find((r) => r.id === summary.ruleId)
      return rule?.safety === 'high'
    })
    const adminNote = cleanerStore.adminBlockedCount
      ? `\n其中 ${cleanerStore.adminBlockedCount} 项需要管理员权限，本次将被跳过。`
      : ''
    const riskNote = highRisk
      ? '\n\n注意：包含高风险项目（回收站 / 下载目录等），清理前请仔细核对。'
      : ''
    try {
      await ElMessageBox.confirm(
        `将清理 ${cleanerStore.selectedSummaries.length} 项，约 ${formatBytes(cleanerStore.selectedBytes)}（${formatNumber(
          cleanerStore.selectedFiles
        )} 个文件）。\n文件删除后无法恢复。${adminNote}${riskNote}`,
        '确认清理',
        {
          confirmButtonText: '开始清理',
          cancelButtonText: '取消',
          type: 'warning',
          distinguishCancelAndClose: true
        }
      )
    } catch {
      return
    }
  }

  try {
    const report = await cleanerStore.clean()
    showReport.value = true
    if (auto) {
      ElMessage.success(`管理员模式清理完成，释放 ${formatBytes(report.deletedBytes)}`)
    }
  } catch (err) {
    if (errorText(err) !== '任务已取消') ElMessage.error(errorText(err))
  }
}

async function onCancel(): Promise<void> {
  const taskId = cleanerStore.cleaningTaskId ?? cleanerStore.scanningTaskId
  if (taskId) await taskStore.cancel(taskId)
}

async function elevation(): Promise<void> {
  const adminRules = cleanerStore.selected.filter((id) => cleanerStore.rules.find((r) => r.id === id)?.adminRequired)
  try {
    const result = await appStore.relaunchElevated(adminRules.length ? adminRules : cleanerStore.selected)
    if (!result.ok) ElMessage.error(result.error || '提权启动失败')
  } catch (err) {
    ElMessage.error(errorText(err))
  }
}

async function openDetail(rule: RuleMeta): Promise<void> {
  detail.rule = rule
  detail.visible = true
  detail.offset = 0
  await loadEntries()
}

async function loadEntries(): Promise<void> {
  if (!detail.rule || !cleanerStore.scanTaskId) return
  detail.loading = true
  try {
    const page = await unwrap(
      window.vein.clean.entries({
        scanTaskId: cleanerStore.scanTaskId,
        ruleId: detail.rule.id,
        offset: detail.offset,
        limit: detail.limit,
        sort: detail.sort
      })
    )
    detail.items = page.items
    detail.total = page.total
  } catch (err) {
    ElMessage.error(errorText(err))
  } finally {
    detail.loading = false
  }
}

async function onDetailPage(page: number): Promise<void> {
  detail.offset = (page - 1) * detail.limit
  await loadEntries()
}

async function onDetailSort(value: string | number | boolean | undefined): Promise<void> {
  detail.sort = value === 'path' ? 'path' : 'size'
  detail.offset = 0
  await loadEntries()
}
</script>

<template>
  <div class="page">
    <div class="page__head">
      <div>
        <h1 class="page__title">一键清理</h1>
        <p class="page__desc">
          扫描系统与浏览器产生的临时文件，先查看明细、可勾选，再执行清理。
        </p>
      </div>
      <div class="page__actions">
        <el-button v-if="!appStore.isAdmin" :icon="Lock" @click="elevation">
          以管理员身份重新启动
        </el-button>
        <el-button
          type="primary"
          :icon="Search"
          :loading="cleanerStore.isScanning"
          :disabled="cleanerStore.isScanning || cleanerStore.isCleaning"
          @click="startScan()"
        >
          {{ cleanerStore.scanState === 'done' ? '重新扫描' : '开始扫描' }}
        </el-button>
        <el-button
          type="success"
          :icon="Delete"
          :disabled="!cleanerStore.selectedSummaries.length || cleanerStore.isScanning || cleanerStore.isCleaning"
          @click="doClean()"
        >
          清理{{ cleanerStore.selectedBytes ? ` ${formatBytes(cleanerStore.selectedBytes)}` : '' }}
        </el-button>
      </div>
    </div>

    <el-alert
      v-if="resumeNotice"
      class="stack-gap"
      type="success"
      :closable="false"
      show-icon
      title="管理员模式已就绪，正在继续上次的清理任务"
    />

    <el-alert
      v-if="!appStore.isAdmin"
      class="stack-gap"
      type="info"
      :closable="false"
      show-icon
      title="当前为标准权限"
      description="Windows 临时目录、更新缓存、字体缓存等项目需要管理员权限。受限项目会自动跳过，你也可以点击右上角按钮提权重启。"
    />

    <div class="toolbar">
      <el-radio-group v-model="activeGroup" size="small">
        <el-radio-button v-for="option in groupOptions" :key="option.value" :value="option.value">
          {{ option.label }}
        </el-radio-button>
      </el-radio-group>
      <div class="toolbar__right">
        <el-button link size="small" @click="cleanerStore.selectAll()">全选</el-button>
        <el-button link size="small" @click="cleanerStore.clearSelection()">清空</el-button>
      </div>
    </div>

    <div v-if="cleanerStore.scanState === 'done'" class="summary-strip">
      <div class="summary-strip__item">
        <span>可释放</span>
        <strong>{{ formatBytes(cleanerStore.selectedBytes) }}</strong>
      </div>
      <div class="summary-strip__item">
        <span>文件</span>
        <strong>{{ formatNumber(cleanerStore.selectedFiles) }}</strong>
      </div>
      <div class="summary-strip__item">
        <span>已选项目</span>
        <strong>{{ cleanerStore.selectedSummaries.length }} 项</strong>
      </div>
      <div v-if="cleanerStore.adminBlockedCount" class="summary-strip__hint">
        <el-icon><Lock /></el-icon>
        {{ cleanerStore.adminBlockedCount }} 项需要管理员权限
      </div>
    </div>

    <div class="rule-grid">
      <CategoryCard
        v-for="rule in filteredRules"
        :key="rule.id"
        :rule="rule"
        :summary="cleanerStore.summaryOf(rule.id)"
        :selected="cleanerStore.selected.includes(rule.id)"
        :disabled="cleanerStore.isScanning || cleanerStore.isCleaning"
        :scanned="cleanerStore.scanState === 'done'"
        @toggle="cleanerStore.toggle(rule.id)"
        @detail="openDetail(rule)"
      />
    </div>

    <el-empty v-if="!filteredRules.length" description="该分类下暂无清理项" />

    <ProgressOverlay
      :visible="cleanerStore.isScanning || cleanerStore.isCleaning"
      :title="cleanerStore.isCleaning ? '正在清理磁盘' : '正在扫描磁盘垃圾'"
      :snapshot="cleanerStore.progress"
      cancellable
      @cancel="onCancel"
    />

    <ResultDialog :visible="showReport" :report="cleanerStore.report" @close="showReport = false" />

    <el-drawer v-model="detail.visible" size="620px" :title="detail.rule?.name || '清理明细'">
      <template v-if="detail.rule">
        <p class="muted drawer-desc">{{ detail.rule.description }}</p>
        <div class="toolbar">
          <el-radio-group :model-value="detail.sort" size="small" @change="onDetailSort">
            <el-radio-button value="size">按大小</el-radio-button>
            <el-radio-button value="path">按路径</el-radio-button>
          </el-radio-group>
          <span class="muted">共 {{ formatNumber(detail.total) }} 项</span>
        </div>
        <el-alert
          v-if="cleanerStore.summaryOf(detail.rule.id)?.truncated"
          class="stack-gap"
          type="info"
          :closable="false"
          title="明细数量过多，这里仅展示前 1000 项；清理时会处理全部内容。"
        />
        <el-table v-loading="detail.loading" :data="detail.items" height="430" size="small">
          <el-table-column prop="path" label="路径" min-width="320" show-overflow-tooltip />
          <el-table-column label="大小" width="110">
            <template #default="{ row }">{{ formatBytes(row.size) }}</template>
          </el-table-column>
          <el-table-column label="修改时间" width="150">
            <template #default="{ row }">{{ formatTime(row.mtimeMs) }}</template>
          </el-table-column>
        </el-table>
        <div class="pager">
          <el-pagination
            layout="prev, pager, next"
            :total="Math.min(detail.total, 1000)"
            :page-size="detail.limit"
            :current-page="Math.floor(detail.offset / detail.limit) + 1"
            @current-change="onDetailPage"
          />
        </div>
      </template>
    </el-drawer>
  </div>
</template>
