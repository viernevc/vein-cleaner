<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { Brush, CopyDocument, PieChart, Refresh } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import { useAnalyzeStore } from '@store/analyze'
import { useAppStore } from '@store/app'
import { errorText } from '../lib/ipc'
import type { DriveInfo } from '@shared/types'
import { formatBytes, formatNumber, formatTime } from '@shared/format'

const router = useRouter()
const analyzeStore = useAnalyzeStore()
const appStore = useAppStore()

onMounted(() => {
  void loadDriveInfo()
})

async function refreshDrives(notify = true): Promise<boolean> {
  try {
    await analyzeStore.loadDrives()
    return true
  } catch (err) {
    if (notify) ElMessage.error(errorText(err))
    return false
  }
}

/** 容量立即展示；卷标由主进程后台补齐，短暂重试几次 */
async function loadDriveInfo(): Promise<void> {
  const ok = await refreshDrives()
  if (!ok || !analyzeStore.drives.length) return
  for (let i = 0; i < 4; i++) {
    if (analyzeStore.drives.every((drive) => drive.label)) return
    await new Promise((resolve) => setTimeout(resolve, 2000))
    await refreshDrives(false)
  }
}

const total = computed(() => analyzeStore.drives.reduce((sum, d) => sum + d.total, 0))
const free = computed(() => analyzeStore.drives.reduce((sum, d) => sum + d.free, 0))
const used = computed(() => Math.max(0, total.value - free.value))
const usedPercent = computed(() =>
  total.value > 0 ? Math.round((used.value / total.value) * 100) : 0
)

function analyzeDrive(drive: DriveInfo): void {
  void router.push({ path: '/analyze', query: { drive: drive.letter, auto: '1' } })
}
</script>

<template>
  <div class="page">
    <div class="page__head">
      <div>
        <h1 class="page__title">概览</h1>
        <p class="page__desc">查看磁盘使用情况，快速进入清理与分析。</p>
      </div>
      <div class="page__actions">
        <el-button :icon="Refresh" @click="refreshDrives()">刷新</el-button>
      </div>
    </div>

    <el-card class="hero-card" shadow="never">
      <div class="hero-card__body">
        <div>
          <div class="hero-card__label">全部磁盘可用空间</div>
          <div class="hero-card__value">{{ formatBytes(free) }}</div>
          <div class="hero-card__meta">
            已用 {{ formatBytes(used) }} / 共 {{ formatBytes(total) }}
            <span class="hero-card__percent">（{{ usedPercent }}%）</span>
          </div>
        </div>
        <div class="hero-card__actions">
          <el-button type="primary" size="large" :icon="Brush" @click="router.push('/clean')">
            一键清理
          </el-button>
          <el-button size="large" :icon="PieChart" @click="router.push('/analyze')">
            空间分析
          </el-button>
          <el-button size="large" :icon="CopyDocument" @click="router.push('/duplicates')">
            重复文件
          </el-button>
        </div>
      </div>
      <el-progress
        class="hero-card__bar"
        :percentage="usedPercent"
        :stroke-width="6"
        :show-text="false"
        color="#35d0ff"
      />
    </el-card>

    <div v-if="analyzeStore.drives.length" class="drive-grid">
      <DriveCard
        v-for="drive in analyzeStore.drives"
        :key="drive.letter"
        :drive="drive"
        @analyze="analyzeDrive"
      />
    </div>
    <el-empty v-else class="empty-block" description="未检测到可用磁盘" />

    <div class="dashboard-grid">
      <el-card class="panel" shadow="never">
        <template #header><span>上次清理</span></template>
        <div v-if="appStore.settings.lastCleanAt" class="last-clean">
          <div class="last-clean__bytes">{{ formatBytes(appStore.settings.lastCleanBytes) }}</div>
          <div class="muted">清理时间：{{ formatTime(appStore.settings.lastCleanAt) }}</div>
        </div>
        <el-empty v-else :image-size="72" description="还没有清理记录" />
      </el-card>

      <el-card class="panel" shadow="never">
        <template #header><span>运行状态</span></template>
        <el-descriptions :column="1" size="small" border>
          <el-descriptions-item label="权限状态">
            <el-tag :type="appStore.isAdmin ? 'success' : 'info'" size="small" effect="dark">
              {{ appStore.isAdmin ? '管理员模式' : '标准权限' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="磁盘数量">
            {{ formatNumber(analyzeStore.drives.length) }} 个
          </el-descriptions-item>
          <el-descriptions-item label="程序版本">v{{ appStore.version }}</el-descriptions-item>
          <el-descriptions-item label="数据目录">
            <span class="path-text" :title="appStore.userDataPath">{{ appStore.userDataPath }}</span>
          </el-descriptions-item>
        </el-descriptions>
      </el-card>
    </div>
  </div>
</template>
