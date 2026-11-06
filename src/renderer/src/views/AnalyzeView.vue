<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { Aim, FolderOpened, Refresh, Search } from '@element-plus/icons-vue'
import { useRoute } from 'vue-router'
import { useAnalyzeStore } from '@store/analyze'
import { useAppStore } from '@store/app'
import { useTaskStore } from '@store/tasks'
import { errorText, unwrap } from '../lib/ipc'
import type { TreeNode } from '@shared/types'
import { formatBytes, formatDuration, formatNumber, formatTime } from '@shared/format'

const analyzeStore = useAnalyzeStore()
const appStore = useAppStore()
const taskStore = useTaskStore()
const route = useRoute()

const selectedDrive = ref('C:')
const theme = computed(() => appStore.effectiveTheme())

onMounted(async () => {
  try {
    await analyzeStore.loadDrives()
    const queryPath = typeof route.query.path === 'string' ? route.query.path : ''
    if (queryPath) {
      selectedDrive.value = ''
      await scanPath(queryPath)
      return
    }
    const queryDrive = typeof route.query.drive === 'string' ? route.query.drive.toUpperCase() : ''
    selectedDrive.value = queryDrive || analyzeStore.drives[0]?.letter || 'C:'
    if (route.query.auto === '1') await startScan()
  } catch (err) {
    ElMessage.error(errorText(err))
  }
})

watch(
  () => route.query.drive,
  (value) => {
    if (typeof value === 'string' && value) {
      selectedDrive.value = value.toUpperCase()
    }
  }
)

watch(
  () => route.query.path,
  (value) => {
    if (typeof value === 'string' && value) {
      selectedDrive.value = ''
      void scanPath(value)
    }
  }
)

async function startScan(): Promise<void> {
  if (!selectedDrive.value && analyzeStore.result?.rootPath) {
    await scanPath(analyzeStore.result.rootPath)
    return
  }
  if (!analyzeStore.drives.length) {
    try {
      await analyzeStore.loadDrives()
    } catch (err) {
      ElMessage.error(errorText(err))
      return
    }
  }
  const drive =
    analyzeStore.drives.find((d) => d.letter === selectedDrive.value) ?? analyzeStore.drives[0]
  if (!drive) {
    ElMessage.warning('未检测到可分析的磁盘')
    return
  }
  selectedDrive.value = drive.letter
  await scanPath(`${drive.letter}:\\`)
}

async function scanPath(target: string): Promise<void> {
  try {
    await analyzeStore.scan(target)
  } catch (err) {
    if (errorText(err) !== '任务已取消') ElMessage.error(errorText(err))
  }
}

async function pickFolder(): Promise<void> {
  try {
    const result = await unwrap(window.vein.dialog.pickFolder())
    if (result.path) {
      selectedDrive.value = ''
      await scanPath(result.path)
    }
  } catch (err) {
    ElMessage.error(errorText(err))
  }
}

async function cancelScan(): Promise<void> {
  if (analyzeStore.scanningTaskId) await taskStore.cancel(analyzeStore.scanningTaskId)
}

async function openPath(path: string): Promise<void> {
  try {
    await analyzeStore.openPath(path)
  } catch (err) {
    ElMessage.error(errorText(err))
  }
}

async function onChildClick(row: TreeNode): Promise<void> {
  if (row.hasChildren) await openPath(row.path)
}

async function reveal(path: string): Promise<void> {
  try {
    await unwrap(window.vein.app.showItem({ path, mode: 'reveal' }))
  } catch (err) {
    ElMessage.error(errorText(err))
  }
}

function onModeChange(value: string | number | boolean | undefined): void {
  analyzeStore.setMode(value === 'sunburst' ? 'sunburst' : 'treemap')
}

const totalBytes = computed(() => analyzeStore.result?.totalBytes ?? 0)
const percentOf = (size: number): string =>
  totalBytes.value > 0 ? `${((size / totalBytes.value) * 100).toFixed(1)}%` : '0%'
</script>

<template>
  <div class="page">
    <div class="page__head">
      <div>
        <h1 class="page__title">磁盘空间分析</h1>
        <p class="page__desc">可视化查看目录占用，快速定位占用空间最多的大文件与文件夹。</p>
      </div>
      <div class="page__actions">
        <el-select
          v-model="selectedDrive"
          style="width: 180px"
          :disabled="analyzeStore.scanning || !analyzeStore.drives.length"
        >
          <el-option
            v-for="drive in analyzeStore.drives"
            :key="drive.letter"
            :value="drive.letter"
            :label="`${drive.name} ${drive.label || '本地磁盘'}`"
          />
        </el-select>
        <el-button :icon="FolderOpened" :disabled="analyzeStore.scanning" @click="pickFolder">
          选择文件夹
        </el-button>
        <el-button
          type="primary"
          :icon="Search"
          :loading="analyzeStore.scanning"
          :disabled="analyzeStore.scanning || !analyzeStore.drives.length"
          @click="startScan"
        >
          {{ analyzeStore.result ? '重新扫描' : '开始扫描' }}
        </el-button>
      </div>
    </div>

    <template v-if="analyzeStore.result">
      <div class="stat-row">
        <div class="stat-card">
          <div class="stat-card__label">已扫描大小</div>
          <div class="stat-card__value">{{ formatBytes(analyzeStore.result.totalBytes) }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">文件数量</div>
          <div class="stat-card__value">{{ formatNumber(analyzeStore.result.totalFiles) }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">目录数量</div>
          <div class="stat-card__value">{{ formatNumber(analyzeStore.result.totalDirs) }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">耗时 / 跳过</div>
          <div class="stat-card__value">
            {{ formatDuration(analyzeStore.result.elapsedMs) }}
            <span class="muted"> · {{ formatNumber(analyzeStore.result.skipped) }}</span>
          </div>
        </div>
      </div>

      <el-alert
        v-if="analyzeStore.result.truncated"
        class="stack-gap"
        type="warning"
        :closable="false"
        show-icon
        title="目录数量超过内存上限，部分深层目录未纳入图表；已扫描数据仍然有效。"
      />

      <div class="breadcrumb-bar">
        <el-breadcrumb separator="/">
          <el-breadcrumb-item v-for="(crumb, index) in analyzeStore.crumbs" :key="crumb.path">
            <a
              v-if="index < analyzeStore.crumbs.length - 1"
              class="crumb-link"
              @click="openPath(crumb.path)"
            >
              {{ crumb.name }}
            </a>
            <span v-else>{{ crumb.name }}</span>
          </el-breadcrumb-item>
        </el-breadcrumb>
      </div>

      <div class="analyze-grid">
        <el-card class="panel" shadow="never">
          <template #header>
            <div class="panel__head">
              <span>目录占用分布</span>
              <el-radio-group :model-value="analyzeStore.mode" size="small" @change="onModeChange">
                <el-radio-button value="treemap">矩形树图</el-radio-button>
                <el-radio-button value="sunburst">环形图</el-radio-button>
              </el-radio-group>
            </div>
          </template>
          <div v-loading="analyzeStore.loadingView" class="chart-wrap">
            <TreemapChart
              :data="analyzeStore.treemap"
              :mode="analyzeStore.mode"
              :theme="theme"
              @node-click="openPath"
            />
            <el-empty
              v-if="!analyzeStore.loadingView && !analyzeStore.treemap?.children?.length"
              description="该目录没有可下钻的子目录"
            />
          </div>
        </el-card>

        <el-card class="panel" shadow="never">
          <template #header>
            <div class="panel__head">
              <span>子目录（{{ formatNumber(analyzeStore.childrenTotal) }}）</span>
              <el-button link size="small" @click="analyzeStore.loadView()">刷新</el-button>
            </div>
          </template>
          <el-table
            :data="analyzeStore.children"
            height="470"
            size="small"
            @row-click="onChildClick"
          >
            <el-table-column label="名称" min-width="180" show-overflow-tooltip>
              <template #default="{ row }">
                <span :class="{ 'clickable-cell': row.hasChildren }">{{ row.name }}</span>
              </template>
            </el-table-column>
            <el-table-column label="大小" width="110" sortable prop="size">
              <template #default="{ row }">{{ formatBytes(row.size) }}</template>
            </el-table-column>
            <el-table-column label="占比" width="80">
              <template #default="{ row }">{{ percentOf(row.size) }}</template>
            </el-table-column>
          </el-table>
        </el-card>
      </div>

      <el-card class="panel stack-gap" shadow="never">
        <template #header>
          <div class="panel__head">
            <span>最大的文件（Top {{ analyzeStore.topFiles.length }}）</span>
            <span class="muted">双击行定位到资源管理器</span>
          </div>
        </template>
        <el-table :data="analyzeStore.topFiles" height="360" size="small" @row-dblclick="(row: any) => reveal(row.path)">
          <el-table-column prop="name" label="文件名" min-width="220" show-overflow-tooltip />
          <el-table-column prop="path" label="路径" min-width="320" show-overflow-tooltip />
          <el-table-column label="大小" width="110" sortable prop="size">
            <template #default="{ row }">{{ formatBytes(row.size) }}</template>
          </el-table-column>
          <el-table-column label="修改时间" width="150">
            <template #default="{ row }">{{ formatTime(row.mtimeMs) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="90">
            <template #default="{ row }">
              <el-button link type="primary" :icon="Aim" @click="reveal(row.path)">定位</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </template>

    <el-empty
      v-else-if="!analyzeStore.scanning"
      class="empty-block"
      description="选择驱动器后开始扫描，整个过程只读，不会删除任何文件"
    >
      <el-button type="primary" :icon="Refresh" :disabled="!analyzeStore.drives.length" @click="startScan">
        开始分析
      </el-button>
    </el-empty>

    <ProgressOverlay
      :visible="analyzeStore.scanning"
      title="正在分析磁盘空间"
      :snapshot="analyzeStore.progress"
      cancellable
      @cancel="cancelScan"
    />
  </div>
</template>
