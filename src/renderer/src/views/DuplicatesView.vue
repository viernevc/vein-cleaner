<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, FolderAdd, Search } from '@element-plus/icons-vue'
import { useRoute } from 'vue-router'
import { useDuplicatesStore } from '@store/duplicates'
import { useTaskStore } from '@store/tasks'
import { errorText, unwrap } from '../lib/ipc'
import type { DriveInfo, KeepRule } from '@shared/types'
import { formatBytes, formatNumber, formatTime } from '@shared/format'

const duplicatesStore = useDuplicatesStore()
const taskStore = useTaskStore()
const route = useRoute()
const drives = ref<DriveInfo[]>([])

const customRoots = computed(() => {
  const driveRoots = new Set(drives.value.map((drive) => `${drive.letter}:\\`))
  return duplicatesStore.roots.filter((root) => !driveRoots.has(root))
})

onMounted(async () => {
  try {
    drives.value = await unwrap(window.vein.analyze.drives())
  } catch (err) {
    ElMessage.error(errorText(err))
  }

  const queryRoots =
    typeof route.query.roots === 'string' ? route.query.roots.split('|').filter(Boolean) : []
  if (queryRoots.length) {
    duplicatesStore.roots = queryRoots
    await startScan()
    return
  }

  if (!duplicatesStore.roots.length && drives.value.length) {
    const system = drives.value.find((d) => d.letter === 'C') ?? drives.value[0]
    duplicatesStore.roots = [`${system.letter}:\\`]
  }
})

watch(
  () => route.query.roots,
  async (value) => {
    if (typeof value === 'string' && value) {
      duplicatesStore.roots = value.split('|').filter(Boolean)
      await startScan()
    }
  }
)

async function addFolder(): Promise<void> {
  try {
    const result = await unwrap(window.vein.dialog.pickFolder())
    if (result.path && !duplicatesStore.roots.includes(result.path)) {
      duplicatesStore.roots.push(result.path)
    }
  } catch (err) {
    ElMessage.error(errorText(err))
  }
}

function isDriveChecked(letter: string): boolean {
  return duplicatesStore.roots.includes(`${letter}:\\`)
}

function toggleDrive(letter: string, checked: boolean): void {
  const root = `${letter}:\\`
  if (checked) {
    if (!duplicatesStore.roots.includes(root)) duplicatesStore.roots.push(root)
  } else {
    duplicatesStore.roots = duplicatesStore.roots.filter((item) => item !== root)
  }
}

function removeRoot(root: string): void {
  duplicatesStore.roots = duplicatesStore.roots.filter((item) => item !== root)
}

async function startScan(): Promise<void> {
  try {
    await duplicatesStore.scan()
  } catch (err) {
    if (errorText(err) !== '任务已取消') ElMessage.error(errorText(err))
  }
}

async function cancelScan(): Promise<void> {
  if (duplicatesStore.scanningTaskId) await taskStore.cancel(duplicatesStore.scanningTaskId)
}

function onKeepChange(value: string | number | boolean | undefined): void {
  duplicatesStore.setKeepRule(value as KeepRule)
}

function onSortChange(value: string | number | boolean | undefined): void {
  void duplicatesStore.setSort(value === 'size' ? 'size' : value === 'count' ? 'count' : 'wasted')
}

function filesOf(groupId: string): Array<{ id: string; path: string; mtimeMs: number }> {
  return duplicatesStore.details[groupId]?.files ?? []
}

function isFileSelected(groupId: string, fileId: string): boolean {
  return (duplicatesStore.selection[groupId] ?? []).includes(fileId)
}

function onFileToggle(groupId: string, fileId: string, checked: boolean): void {
  const current = duplicatesStore.selection[groupId] ?? []
  const next = checked ? [...current, fileId] : current.filter((id) => id !== fileId)
  const ok = duplicatesStore.updateSelection(groupId, next)
  if (!ok) ElMessage.warning('每组至少保留一个文件')
}

async function reveal(path: string): Promise<void> {
  try {
    await unwrap(window.vein.app.showItem({ path, mode: 'reveal' }))
  } catch (err) {
    ElMessage.error(errorText(err))
  }
}

async function removeSelected(): Promise<void> {
  if (!duplicatesStore.selectedCount) return
  try {
    await ElMessageBox.confirm(
      `将把 ${formatNumber(duplicatesStore.selectedCount)} 个文件移入回收站，可释放约 ${formatBytes(
        duplicatesStore.selectedBytes
      )}。\n每组至少保留一个文件，删除后可在回收站中恢复。`,
      '确认移入回收站',
      { confirmButtonText: '移入回收站', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  try {
    const result = await duplicatesStore.removeSelected()
    if (result.failures.length) {
      ElMessage.warning(
        `已移入回收站 ${formatNumber(result.trashed)} 个文件，${formatNumber(result.failures.length)} 个失败`
      )
    } else {
      ElMessage.success(
        `已移入回收站 ${formatNumber(result.trashed)} 个文件，释放 ${formatBytes(result.trashedBytes)}`
      )
    }
  } catch (err) {
    ElMessage.error(errorText(err))
  }
}
</script>

<template>
  <div class="page">
    <div class="page__head">
      <div>
        <h1 class="page__title">重复文件查找</h1>
        <p class="page__desc">
          按大小、部分哈希、完整哈希三级比对，找出内容相同的文件；删除时移入回收站，保证可恢复。
        </p>
      </div>
      <div class="page__actions">
        <el-button
          type="primary"
          :icon="Search"
          :loading="duplicatesStore.scanning"
          :disabled="duplicatesStore.scanning || !duplicatesStore.roots.length"
          @click="startScan"
        >
          开始扫描
        </el-button>
      </div>
    </div>

    <el-card class="panel" shadow="never">
      <div class="dup-config">
        <div class="form-row">
          <span class="form-label">扫描范围</span>
          <div class="drive-picker">
            <el-checkbox
              v-for="drive in drives"
              :key="drive.letter"
              :model-value="isDriveChecked(drive.letter)"
              @change="(value: any) => toggleDrive(drive.letter, !!value)"
            >
              {{ drive.name }} {{ drive.label || '' }}
            </el-checkbox>
            <el-button link type="primary" :icon="FolderAdd" @click="addFolder">
              添加文件夹
            </el-button>
          </div>
        </div>

        <div v-if="customRoots.length" class="root-tags">
          <el-tag
            v-for="root in customRoots"
            :key="root"
            closable
            effect="plain"
            @close="removeRoot(root)"
          >
            {{ root }}
          </el-tag>
        </div>

        <div class="form-row">
          <span class="form-label">最小文件大小</span>
          <el-input-number v-model="duplicatesStore.minSizeMb" :min="0" :max="1024" :step="1" />
          <span class="muted">MB</span>
          <span class="muted form-hint">
            扫描整个磁盘可能耗时较长，建议先选择具体目录或调大最小文件大小。
          </span>
        </div>
      </div>
    </el-card>

    <template v-if="duplicatesStore.result">
      <div class="stat-row">
        <div class="stat-card">
          <div class="stat-card__label">重复组</div>
          <div class="stat-card__value">{{ formatNumber(duplicatesStore.result.totalGroups) }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">可释放</div>
          <div class="stat-card__value">{{ formatBytes(duplicatesStore.result.wastedBytes) }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">涉及文件</div>
          <div class="stat-card__value">{{ formatNumber(duplicatesStore.result.totalFiles) }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">候选文件</div>
          <div class="stat-card__value">{{ formatNumber(duplicatesStore.result.candidates) }}</div>
        </div>
      </div>

      <el-alert
        v-if="duplicatesStore.result.truncated"
        class="stack-gap"
        type="warning"
        :closable="false"
        show-icon
        title="候选文件数量达到上限，结果可能不完整，建议缩小扫描范围或提高最小文件大小。"
      />

      <el-alert
        v-if="duplicatesStore.result.totalGroups === 0"
        class="stack-gap"
        type="success"
        :closable="false"
        show-icon
        title="当前没有可处理的重复文件"
        description="扫描范围内没有内容相同的文件，或已全部处理完毕。"
      />

      <template v-if="duplicatesStore.total > 0">
        <div class="toolbar">
          <div class="toolbar__left">
            <span class="muted">保留规则</span>
            <el-select
              :model-value="duplicatesStore.keepRule"
              size="small"
              style="width: 150px"
              @change="onKeepChange"
            >
              <el-option value="newest" label="保留最新修改" />
              <el-option value="oldest" label="保留最早创建" />
              <el-option value="shortest-path" label="保留路径最短" />
              <el-option value="manual" label="手动选择" />
            </el-select>
            <span class="muted">排序</span>
            <el-select
              :model-value="duplicatesStore.sort"
              size="small"
              style="width: 140px"
              @change="onSortChange"
            >
              <el-option value="wasted" label="可释放空间" />
              <el-option value="size" label="单文件大小" />
              <el-option value="count" label="文件数量" />
            </el-select>
          </div>
          <div class="toolbar__right">
            <span class="muted">
              已选 {{ formatNumber(duplicatesStore.selectedCount) }} 个 · {{ formatBytes(duplicatesStore.selectedBytes) }}
            </span>
            <el-button
              type="danger"
              :icon="Delete"
              :disabled="!duplicatesStore.selectedCount || duplicatesStore.deleting"
              :loading="duplicatesStore.deleting"
              @click="removeSelected"
            >
              移入回收站
            </el-button>
          </div>
        </div>

        <el-collapse
          :model-value="duplicatesStore.expanded"
          class="dup-groups"
          @change="(value: any) => duplicatesStore.onExpandedChange(value as string[])"
        >
          <el-collapse-item v-for="group in duplicatesStore.groups" :key="group.id" :name="group.id">
            <template #title>
              <div class="dup-group__head">
                <span class="dup-group__size">{{ formatBytes(group.size) }} × {{ group.count }}</span>
                <span class="dup-group__wasted">可释放 {{ formatBytes(group.wasted) }}</span>
                <span class="muted">{{ duplicatesStore.selection[group.id]?.length ?? 0 }} 个待删除</span>
              </div>
            </template>

            <el-table v-if="duplicatesStore.details[group.id]" :data="filesOf(group.id)" size="small">
              <el-table-column width="48">
                <template #default="{ row }">
                  <el-checkbox
                    :model-value="isFileSelected(group.id, row.id)"
                    @change="(value: any) => onFileToggle(group.id, row.id, !!value)"
                  />
                </template>
              </el-table-column>
              <el-table-column prop="path" label="路径" min-width="360" show-overflow-tooltip />
              <el-table-column label="修改时间" width="150">
                <template #default="{ row }">{{ formatTime(row.mtimeMs) }}</template>
              </el-table-column>
              <el-table-column label="操作" width="90">
                <template #default="{ row }">
                  <el-button link size="small" @click="reveal(row.path)">定位</el-button>
                </template>
              </el-table-column>
            </el-table>
            <el-skeleton v-else :rows="2" animated />
          </el-collapse-item>
        </el-collapse>

        <div class="pager">
          <el-pagination
            layout="total, prev, pager, next"
            :total="duplicatesStore.total"
            :page-size="duplicatesStore.pageSize"
            :current-page="duplicatesStore.page"
            @current-change="(page: number) => duplicatesStore.setPage(page)"
          />
        </div>
      </template>
    </template>

    <el-empty
      v-else-if="!duplicatesStore.scanning"
      class="empty-block"
      description="选择扫描范围后开始查找重复文件"
    />

    <ProgressOverlay
      :visible="duplicatesStore.scanning"
      title="正在查找重复文件"
      :snapshot="duplicatesStore.progress"
      cancellable
      @cancel="cancelScan"
    />
  </div>
</template>
