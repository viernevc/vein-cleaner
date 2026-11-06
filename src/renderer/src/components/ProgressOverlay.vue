<script setup lang="ts">
import type { TaskSnapshot } from '@shared/types'
import { formatBytes, formatNumber } from '@shared/format'

const props = defineProps<{
  visible: boolean
  title: string
  snapshot: TaskSnapshot | null
  cancellable?: boolean
}>()

const emit = defineEmits<{ (e: 'cancel'): void }>()

const percent = computed(() => Math.round(props.snapshot?.percent ?? 0))
const indeterminate = computed(
  () => props.snapshot?.percent === null || props.snapshot?.percent === undefined
)
const bytesText = computed(() => {
  const snapshot = props.snapshot
  if (!snapshot) return '0 B'
  if (snapshot.bytesTotal && snapshot.bytesTotal > 0) {
    return `${formatBytes(snapshot.bytesDone)} / ${formatBytes(snapshot.bytesTotal)}`
  }
  return formatBytes(snapshot.bytesDone)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="visible" class="progress-overlay">
        <div class="progress-panel">
          <div class="progress-panel__title">{{ title }}</div>
          <div class="progress-panel__phase">{{ snapshot?.phase || '正在准备…' }}</div>
          <el-progress
            v-if="!indeterminate"
            :percentage="percent"
            :stroke-width="8"
            color="#35d0ff"
          />
          <div v-else class="progress-indeterminate"><span /></div>
          <div class="progress-panel__stats">
            <span>{{ formatNumber(snapshot?.done ?? 0) }} 项</span>
            <span>{{ bytesText }}</span>
          </div>
          <div class="progress-panel__path" :title="snapshot?.currentPath">
            {{ snapshot?.currentPath || '—' }}
          </div>
          <div class="progress-panel__actions">
            <el-button v-if="cancellable" plain @click="emit('cancel')">取消</el-button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
