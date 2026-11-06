<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import brandIcon from '@renderer/assets/brand.png'
import { useAppStore } from '@store/app'
import { useTaskStore } from '@store/tasks'

const route = useRoute()
const router = useRouter()
const appStore = useAppStore()
const taskStore = useTaskStore()

const items = [
  { path: '/dashboard', label: '概览', icon: 'Odometer' },
  { path: '/clean', label: '一键清理', icon: 'Brush' },
  { path: '/analyze', label: '空间分析', icon: 'PieChart' },
  { path: '/duplicates', label: '重复文件', icon: 'CopyDocument' },
  { path: '/settings', label: '设置', icon: 'Setting' }
]

const activeTask = computed(() => {
  const running = Object.values(taskStore.tasks).filter(
    (task) => task.state === 'running' || task.state === 'queued' || task.state === 'cancelling'
  )
  return running.sort((a, b) => b.startedAt - a.startedAt)[0] ?? null
})

const taskLabel = computed(() => {
  const phase = activeTask.value?.phase ?? ''
  if (phase.includes('枚举') || phase.includes('哈希') || phase.includes('分组')) {
    return '重复文件扫描'
  }
  if (phase.includes('目录') || phase.includes('分析')) return '空间分析'
  if (phase.startsWith('清理')) return '正在清理'
  return '正在扫描'
})

function openTask(): void {
  const phase = activeTask.value?.phase ?? ''
  if (phase.includes('枚举') || phase.includes('哈希') || phase.includes('分组')) {
    void router.push('/duplicates')
  } else if (phase.includes('目录') || phase.includes('分析')) {
    void router.push('/analyze')
  } else {
    void router.push('/clean')
  }
}
</script>

<template>
  <div class="app-shell">
    <TitleBar />
    <div class="app-body">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand__mark">
            <img :src="brandIcon" alt="Vein" />
          </div>
          <div class="brand__text">
            <strong>Vein</strong>
            <span>磁盘清理</span>
          </div>
        </div>

        <el-scrollbar class="sidebar__scroll">
          <el-menu :default-active="route.path" router class="side-menu">
            <el-menu-item v-for="item in items" :key="item.path" :index="item.path">
              <el-icon><component :is="item.icon" /></el-icon>
              <span>{{ item.label }}</span>
            </el-menu-item>
          </el-menu>
        </el-scrollbar>

        <div v-if="activeTask" class="sidebar__task" @click="openTask">
          <div class="sidebar__task-head">
            <span>{{ taskLabel }}</span>
            <span>{{ activeTask.percent === null ? '进行中' : `${Math.round(activeTask.percent)}%` }}</span>
          </div>
          <el-progress
            :percentage="Math.round(activeTask.percent ?? 0)"
            :indeterminate="activeTask.percent === null"
            :show-text="false"
            :stroke-width="4"
            :duration="2"
          />
        </div>

        <div class="sidebar__foot">
          <el-tag :type="appStore.isAdmin ? 'success' : 'info'" size="small" effect="dark">
            {{ appStore.isAdmin ? '管理员模式' : '标准权限' }}
          </el-tag>
          <span class="muted">v{{ appStore.version }}</span>
        </div>
      </aside>

      <main class="content">
        <el-scrollbar :key="route.path">
          <div class="content__inner">
            <RouterView />
          </div>
        </el-scrollbar>
      </main>
    </div>
  </div>
</template>
