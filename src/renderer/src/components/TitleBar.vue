<script setup lang="ts">
import { Close, FullScreen, Minus, Moon, Sunny } from '@element-plus/icons-vue'
import brandIcon from '@renderer/assets/brand.png'
import { useAppStore } from '@store/app'

const appStore = useAppStore()
const maximized = ref(false)
let off: (() => void) | null = null

onMounted(() => {
  off = window.vein.window.onMaximized((value) => {
    maximized.value = value
  })
})

onUnmounted(() => {
  off?.()
})

function minimize(): void {
  void window.vein.window.control('minimize')
}
function toggleMaximize(): void {
  void window.vein.window.control('toggle-maximize')
}
function close(): void {
  void window.vein.window.control('close')
}
async function toggleTheme(): Promise<void> {
  const next = appStore.effectiveTheme() === 'dark' ? 'light' : 'dark'
  await appStore.setTheme(next)
}
</script>

<template>
  <header class="titlebar" @dblclick="toggleMaximize">
    <div class="titlebar__title">
      <img class="titlebar__icon" :src="brandIcon" alt="" />
      Vein 磁盘清理
    </div>
    <div class="titlebar__actions" @dblclick.stop>
      <el-tooltip :content="appStore.effectiveTheme() === 'dark' ? '切换到浅色' : '切换到深色'" placement="bottom">
        <button class="win-btn theme-btn" aria-label="切换主题" @click="toggleTheme">
          <el-icon><component :is="appStore.effectiveTheme() === 'dark' ? Sunny : Moon" /></el-icon>
        </button>
      </el-tooltip>
      <button class="win-btn" aria-label="最小化" @click="minimize">
        <el-icon><Minus /></el-icon>
      </button>
      <button class="win-btn" :aria-label="maximized ? '还原' : '最大化'" @click="toggleMaximize">
        <el-icon><FullScreen /></el-icon>
      </button>
      <button class="win-btn win-btn--close" aria-label="关闭" @click="close">
        <el-icon><Close /></el-icon>
      </button>
    </div>
  </header>
</template>
