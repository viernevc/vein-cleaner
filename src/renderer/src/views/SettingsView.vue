<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { CopyDocument, FolderOpened } from '@element-plus/icons-vue'
import { useAppStore } from '@store/app'
import { errorText, unwrap } from '../lib/ipc'
import type { SetLogDirResult, ThemeMode } from '@shared/types'

const appStore = useAppStore()

const ageDays = ref(appStore.settings.downloadAgeDays)
const minSizeMb = ref(Math.round(appStore.settings.minDuplicateSize / (1024 * 1024)))
const excludeText = ref(appStore.settings.excludeDirs.join(', '))

watch(
  () => appStore.settings,
  (settings) => {
    ageDays.value = settings.downloadAgeDays
    minSizeMb.value = Math.round(settings.minDuplicateSize / (1024 * 1024))
    excludeText.value = settings.excludeDirs.join(', ')
  },
  { deep: true }
)

async function setTheme(value: string | number | boolean | undefined): Promise<void> {
  try {
    await appStore.setTheme(value as ThemeMode)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}

async function setSlowMode(value: string | number | boolean | undefined): Promise<void> {
  try {
    await appStore.updateSettings({ slowMode: !!value })
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}

async function saveAge(): Promise<void> {
  try {
    await appStore.updateSettings({ downloadAgeDays: ageDays.value })
    ElMessage.success('已保存')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}

async function saveMinSize(): Promise<void> {
  try {
    await appStore.updateSettings({ minDuplicateSize: Math.round(minSizeMb.value * 1024 * 1024) })
    ElMessage.success('已保存')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}

async function saveExclude(): Promise<void> {
  try {
    const list = excludeText.value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    await appStore.updateSettings({ excludeDirs: list })
    ElMessage.success('已保存')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制到剪贴板')
  } catch {
    ElMessage.warning('复制失败，请手动选择文本')
  }
}

async function pickLogDir(): Promise<void> {
  try {
    const result = await unwrap(
      window.vein.dialog.pickFolder({
        defaultPath: appStore.settings.logDir || appStore.logsPath
      })
    )
    if (!result.path) return
    notifyLogDirChange(await appStore.setLogDir(result.path))
  } catch (err) {
    ElMessage.error(errorText(err))
  }
}

async function resetLogDir(): Promise<void> {
  try {
    notifyLogDirChange(await appStore.setLogDir(''))
  } catch (err) {
    ElMessage.error(errorText(err))
  }
}

function notifyLogDirChange(result: SetLogDirResult): void {
  if (result.failed.length) {
    ElMessage.warning(
      `日志目录已切换，但 ${result.failed.join('、')} 迁移失败（文件可能被占用）`
    )
  } else if (result.moved.length) {
    ElMessage.success(`日志目录已切换，已迁移 ${result.moved.join('、')}`)
  } else {
    ElMessage.success('日志目录已切换')
  }
}
</script>

<template>
  <div class="page">
    <div class="page__head">
      <div>
        <h1 class="page__title">设置</h1>
        <p class="page__desc">调整外观与扫描策略，设置会立即生效并持久保存。</p>
      </div>
    </div>

    <el-card class="panel" shadow="never">
      <template #header><span>外观</span></template>
      <el-form label-width="150px" label-position="left">
        <el-form-item label="主题">
          <el-radio-group :model-value="appStore.settings.theme" @change="setTheme">
            <el-radio-button value="dark">深色</el-radio-button>
            <el-radio-button value="light">浅色</el-radio-button>
            <el-radio-button value="green">护眼绿</el-radio-button>
            <el-radio-button value="system">跟随系统</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="低速模式">
          <el-switch
            :model-value="appStore.settings.slowMode"
            @change="setSlowMode"
          />
          <span class="form-note">机械硬盘或后台有其他重任务时开启，降低扫描并发。</span>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="panel stack-gap" shadow="never">
      <template #header><span>扫描策略</span></template>
      <el-form label-width="150px" label-position="left">
        <el-form-item label="下载目录清理阈值">
          <el-input-number v-model="ageDays" :min="1" :max="3650" @change="saveAge" />
          <span class="form-note">仅清理超过该天数未修改的文件（默认不勾选该清理项）。</span>
        </el-form-item>
        <el-form-item label="重复文件最小尺寸">
          <el-input-number v-model="minSizeMb" :min="0" :max="1024" @change="saveMinSize" />
          <span class="form-note">单位 MB，小于该值的文件不参与重复比对。</span>
        </el-form-item>
        <el-form-item label="重复扫描排除目录">
          <el-input v-model="excludeText" style="width: 420px" @blur="saveExclude" />
          <span class="form-note">逗号分隔的目录名，例如 node_modules, .git</span>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="panel stack-gap" shadow="never">
      <template #header><span>运行信息</span></template>
      <el-descriptions :column="1" border size="small">
        <el-descriptions-item label="权限状态">
          <el-tag :type="appStore.isAdmin ? 'success' : 'info'" size="small" effect="dark">
            {{ appStore.isAdmin ? '管理员模式' : '标准权限' }}
          </el-tag>
          <span v-if="appStore.elevated" class="form-note">本次会话通过 UAC 提权启动</span>
        </el-descriptions-item>
        <el-descriptions-item label="程序版本">v{{ appStore.version }}</el-descriptions-item>
        <el-descriptions-item label="数据目录">
          <span class="path-text">{{ appStore.userDataPath }}</span>
          <el-button link type="primary" :icon="CopyDocument" @click="copy(appStore.userDataPath)">
            复制
          </el-button>
        </el-descriptions-item>
        <el-descriptions-item label="日志目录">
          <div class="log-dir-cell">
            <span class="path-text">{{ appStore.logsPath }}</span>
            <el-button
              size="small"
              link
              type="primary"
              :icon="CopyDocument"
              @click="copy(appStore.logsPath)"
            >
              复制
            </el-button>
            <div class="log-dir-actions">
              <el-button
                v-if="appStore.settings.logDir"
                size="small"
                link
                @click="resetLogDir"
              >
                恢复默认
              </el-button>
              <el-button size="small" :icon="FolderOpened" @click="pickLogDir">
                更改目录
              </el-button>
            </div>
          </div>
        </el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-card class="panel stack-gap" shadow="never">
      <template #header><span>关于</span></template>
      <p class="about-text">
        Vein 磁盘清理是一款面向 Windows 的磁盘空间清理与分析工具。所有清理操作都需要先扫描、确认后执行；
        删除时不会跟随符号链接或目录联接，重复文件与下载目录旧文件一律移入回收站。
      </p>
      <p class="about-text muted">
        提示：系统级清理（Windows 临时目录、更新缓存、字体缓存等）需要管理员权限，可在「一键清理」页提权重启。
      </p>
    </el-card>
  </div>
</template>
