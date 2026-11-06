<script setup lang="ts">
import type { ConfigProviderProps } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { applyThemeClass, resolveTheme } from '@composables/useTheme'
import { useAppStore } from '@store/app'
import { useTaskStore } from '@store/tasks'

const appStore = useAppStore()
const taskStore = useTaskStore()

let media: MediaQueryList | null = null
function onSchemeChange(): void {
  if (appStore.settings.theme === 'system') {
    applyThemeClass(resolveTheme('system'))
  }
}

const ElementDefaultConfig = {
  locale: zhCn,
  namespace: 'elp',
  button: {
    autoInsertSpace: true
  }
} satisfies Partial<ConfigProviderProps>

onMounted(async () => {
  taskStore.bind()
  try {
    await appStore.init()
  } catch (err) {
    console.error('初始化应用状态失败', err)
  }
  media = window.matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', onSchemeChange)
})

onUnmounted(() => {
  media?.removeEventListener('change', onSchemeChange)
})
</script>

<template>
  <el-config-provider v-bind="ElementDefaultConfig">
    <MainLayout v-if="appStore.ready" />
    <div v-else class="boot-screen">
      <div class="boot-logo">Vein</div>
      <div class="boot-text">正在初始化磁盘清理引擎…</div>
    </div>
  </el-config-provider>
</template>
