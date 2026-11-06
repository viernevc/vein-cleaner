<script setup lang="ts">
import type { DriveInfo } from '@shared/types'
import { formatBytes } from '@shared/format'

const props = defineProps<{ drive: DriveInfo }>()
const emit = defineEmits<{ (e: 'analyze', drive: DriveInfo): void }>()

const used = computed(() => Math.max(0, props.drive.total - props.drive.free))
const percent = computed(() =>
  props.drive.total > 0 ? Math.round((used.value / props.drive.total) * 100) : 0
)
const color = computed(() => {
  if (percent.value >= 90) return '#ff5d73'
  if (percent.value >= 75) return '#ffb454'
  return '#35d0ff'
})

function analyze(): void {
  emit('analyze', props.drive)
}
</script>

<template>
  <el-card class="drive-card" shadow="never" @click="analyze">
    <div class="drive-card__ring">
      <el-progress
        type="circle"
        :percentage="percent"
        :width="92"
        :stroke-width="8"
        :color="color"
      >
        <template #default>
          <div class="drive-card__percent">{{ percent }}%</div>
          <div class="drive-card__label">已用</div>
        </template>
      </el-progress>
    </div>
    <div class="drive-card__info">
      <div class="drive-card__name">{{ drive.name }}</div>
      <div class="drive-card__volume">{{ drive.label || '本地磁盘' }}</div>
      <div class="drive-card__meta">
        <span>已用 {{ formatBytes(used) }}</span>
        <span>可用 {{ formatBytes(drive.free) }}</span>
      </div>
      <div class="drive-card__total">共 {{ formatBytes(drive.total) }}</div>
    </div>
  </el-card>
</template>
