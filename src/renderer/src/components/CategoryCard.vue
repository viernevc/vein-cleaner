<script setup lang="ts">
import { Check, Lock, Warning } from '@element-plus/icons-vue'
import type { RuleMeta, RuleScanSummary } from '@shared/types'
import { formatBytes, formatNumber } from '@shared/format'

const props = defineProps<{
  rule: RuleMeta
  summary?: RuleScanSummary
  selected: boolean
  disabled?: boolean
  scanned?: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle'): void
  (e: 'detail'): void
}>()

const safety = computed(() => {
  if (props.rule.safety === 'high') return { label: '谨慎', type: 'danger' as const }
  if (props.rule.safety === 'medium') return { label: '注意', type: 'warning' as const }
  return { label: '安全', type: 'success' as const }
})

const adminSkipped = computed(() => props.summary?.status === 'admin-skipped')
const hasSummary = computed(() => !!props.summary)
const sizeText = computed(() => {
  if (props.summary) return formatBytes(props.summary.bytes)
  return props.scanned ? '未扫描' : '—'
})
const metaText = computed(() => {
  if (props.summary) {
    return `${formatNumber(props.summary.files)} 个文件${
      props.summary.dirs ? ` · ${formatNumber(props.summary.dirs)} 个目录` : ''
    }`
  }
  return props.scanned ? '未包含在本次扫描中' : '等待扫描'
})
const canDetail = computed(() => {
  const s = props.summary
  return !!s && s.status === 'ok' && props.rule.special !== 'recycle-bin' && (s.files > 0 || s.bytes > 0)
})

function onCardClick(): void {
  if (props.disabled) return
  emit('toggle')
}
</script>

<template>
  <el-card
    class="rule-card"
    :class="{ 'is-selected': selected && !adminSkipped, 'is-disabled': disabled, 'is-skipped': adminSkipped }"
    shadow="never"
    @click="onCardClick"
  >
    <div class="rule-card__head">
      <el-checkbox
        :model-value="selected"
        :disabled="disabled"
        @click.stop
        @change="emit('toggle')"
      />
      <div class="rule-card__title" :title="rule.description">{{ rule.name }}</div>
      <el-icon v-if="adminSkipped" class="rule-card__lock"><Lock /></el-icon>
    </div>

    <div class="rule-card__tags">
      <el-tag size="small" :type="safety.type" effect="dark">{{ safety.label }}</el-tag>
      <el-tag v-if="rule.adminRequired" size="small" type="info" effect="plain">管理员</el-tag>
      <el-tag v-if="rule.defaultEnabled" size="small" type="info" effect="plain">推荐</el-tag>
    </div>

    <div class="rule-card__size" :class="{ 'rule-card__size--idle': !hasSummary }">
      {{ sizeText }}
    </div>
    <div class="rule-card__meta">{{ metaText }}</div>

    <el-alert
      v-if="adminSkipped"
      class="rule-card__alert"
      type="info"
      :closable="false"
      show-icon
      title="需要管理员权限"
    />
    <div v-else-if="summary?.message" class="rule-card__hint">
      <el-icon><Warning /></el-icon>
      <span>{{ summary.message }}</span>
    </div>
    <div v-else class="rule-card__hint rule-card__hint--muted">{{ rule.description }}</div>

    <div class="rule-card__foot">
      <el-button v-if="canDetail" link type="primary" size="small" @click.stop="emit('detail')">
        查看明细
      </el-button>
      <span v-else class="rule-card__state">
        <el-icon v-if="selected && !adminSkipped"><Check /></el-icon>
      </span>
    </div>
  </el-card>
</template>
