<script setup lang="ts">
import type { CleanReport } from '@shared/types'
import { formatBytes, formatDuration, formatNumber } from '@shared/format'

const props = defineProps<{ visible: boolean; report: CleanReport | null }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const activeTab = ref('failures')

const hasProblems = computed(
  () => (props.report?.failures.length ?? 0) > 0 || (props.report?.skipped.length ?? 0) > 0
)
const icon = computed(() => {
  if (!props.report) return 'info'
  if (props.report.cancelled) return 'warning'
  return props.report.deletedBytes > 0 ? 'success' : 'info'
})
const title = computed(() => {
  if (!props.report) return '清理结果'
  if (props.report.cancelled) return '清理已取消'
  return '清理完成'
})

function close(): void {
  emit('close')
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    width="660px"
    align-center
    class="result-dialog"
    @update:model-value="(v: boolean) => !v && close()"
  >
    <template #header>
      <span class="result-dialog__title">清理结果</span>
    </template>

    <el-result
      v-if="report"
      :icon="icon"
      :title="title"
      :sub-title="`耗时 ${formatDuration(report.elapsedMs)}`"
    >
      <template #extra>
        <div class="result-stats">
          <div class="result-stat">
            <div class="result-stat__value">{{ formatBytes(report.deletedBytes) }}</div>
            <div class="result-stat__label">释放空间</div>
          </div>
          <div class="result-stat">
            <div class="result-stat__value">{{ formatNumber(report.deletedFiles) }}</div>
            <div class="result-stat__label">删除文件</div>
          </div>
          <div class="result-stat">
            <div class="result-stat__value">{{ formatNumber(report.deletedDirs) }}</div>
            <div class="result-stat__label">删除目录</div>
          </div>
          <div class="result-stat" :class="{ 'is-warn': hasProblems }">
            <div class="result-stat__value">
              {{ formatNumber(report.failures.length) }} / {{ formatNumber(report.skipped.length) }}
            </div>
            <div class="result-stat__label">失败 / 跳过</div>
          </div>
        </div>
      </template>
    </el-result>

    <el-tabs v-if="report && hasProblems" v-model="activeTab" class="result-tabs">
      <el-tab-pane :label="`失败 ${report.failures.length}`" name="failures">
        <el-table :data="report.failures" height="220" size="small">
          <el-table-column prop="path" label="路径" min-width="320" show-overflow-tooltip />
          <el-table-column prop="code" label="代码" width="110" />
          <el-table-column prop="message" label="原因" width="160" show-overflow-tooltip />
        </el-table>
      </el-tab-pane>
      <el-tab-pane :label="`跳过 ${report.skipped.length}`" name="skipped">
        <el-table :data="report.skipped" height="220" size="small">
          <el-table-column prop="path" label="路径/项目" min-width="320" show-overflow-tooltip />
          <el-table-column prop="code" label="代码" width="110" />
          <el-table-column prop="message" label="原因" width="160" show-overflow-tooltip />
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <template #footer>
      <el-button type="primary" @click="close">完成</el-button>
    </template>
  </el-dialog>
</template>
