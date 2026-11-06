<script setup lang="ts">
import * as echarts from 'echarts'
import type { TreemapNode } from '@shared/types'
import { formatBytes } from '@shared/format'

const props = defineProps<{
  data: TreemapNode | null
  mode: 'treemap' | 'sunburst'
  theme: 'dark' | 'light'
}>()

const emit = defineEmits<{ (e: 'node-click', path: string): void }>()

const container = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null
let observer: ResizeObserver | null = null

const DARK_COLORS = ['#2a9fd6', '#3d7bff', '#7b61ff', '#b45cff', '#00b8a9', '#e0a33e', '#e2647a', '#4bb8a9']
const LIGHT_COLORS = ['#4aa8d8', '#5b7cf0', '#8b6ff0', '#b06fd6', '#2bb39f', '#d79a34', '#d96178', '#51a99b']

function render(): void {
  if (!chart) return
  if (!props.data) {
    chart.clear()
    return
  }
  const dark = props.theme === 'dark'
  const palette = dark ? DARK_COLORS : LIGHT_COLORS
  const textColor = dark ? '#e7eefb' : '#17233a'
  const mutedColor = dark ? '#9fb2cc' : '#4a5c78'
  const borderColor = dark ? 'rgba(11, 15, 25, 0.92)' : '#f3f6fb'

  if (props.mode === 'treemap') {
    const children = props.data.children?.length ? props.data.children : [props.data]
    chart.setOption(
      {
        backgroundColor: 'transparent',
        color: palette,
        tooltip: {
          renderMode: 'richText',
          backgroundColor: dark ? 'rgba(15, 22, 38, 0.96)' : '#ffffff',
          borderColor: dark ? 'rgba(120, 170, 255, 0.2)' : 'rgba(30, 60, 120, 0.16)',
          textStyle: { color: textColor, fontSize: 12 },
          formatter: (info: { name?: string; value?: number }) =>
            `${info.name ?? ''}\n${formatBytes(Number(info.value) || 0)}`
        },
        series: [
          {
            type: 'treemap',
            roam: false,
            nodeClick: false,
            breadcrumb: { show: false },
            leafDepth: 1,
            label: {
              show: true,
              color: textColor,
              fontSize: 12,
              formatter: (params: { name?: string; value?: number }) =>
                `${params.name ?? ''}\n${formatBytes(Number(params.value) || 0)}`
            },
            upperLabel: { show: false },
            itemStyle: {
              borderColor,
              borderWidth: 2,
              gapWidth: 2,
              borderRadius: 4
            },
            levels: [{ itemStyle: { borderWidth: 0, gapWidth: 2 } }],
            data: children
          }
        ]
      },
      true
    )
    return
  }

  chart.setOption(
    {
      backgroundColor: 'transparent',
      color: palette,
      tooltip: {
        renderMode: 'richText',
        backgroundColor: dark ? 'rgba(15, 22, 38, 0.96)' : '#ffffff',
        borderColor: dark ? 'rgba(120, 170, 255, 0.2)' : 'rgba(30, 60, 120, 0.16)',
        textStyle: { color: textColor, fontSize: 12 },
        formatter: (info: { name?: string; value?: number }) =>
          `${info.name ?? ''}\n${formatBytes(Number(info.value) || 0)}`
      },
      series: [
        {
          type: 'sunburst',
          data: [props.data],
          radius: ['16%', '92%'],
          sort: (a: { value?: number }, b: { value?: number }) =>
            (Number(b.value) || 0) - (Number(a.value) || 0),
          label: {
            rotate: 'radial',
            color: textColor,
            fontSize: 11,
            minAngle: 8
          },
          itemStyle: {
            borderColor,
            borderWidth: 1.5,
            borderRadius: 3
          },
          emphasis: { focus: 'ancestor' },
          levels: [
            {},
            {
              r0: '16%',
              r: '46%',
              label: { align: 'right', color: mutedColor }
            },
            {
              r0: '46%',
              r: '72%',
              label: { position: 'outside', padding: 2, color: textColor, fontSize: 10 }
            },
            {
              r0: '72%',
              r: '92%',
              label: { position: 'outside', padding: 2, color: textColor, fontSize: 10 }
            }
          ]
        }
      ]
    },
    true
  )
}

onMounted(() => {
  if (!container.value) return
  chart = echarts.init(container.value, undefined, { renderer: 'canvas' })
  chart.on('click', (params) => {
    const data = params.data as TreemapNode | undefined
    if (data?.path) emit('node-click', data.path)
  })
  observer = new ResizeObserver(() => chart?.resize())
  observer.observe(container.value)
  render()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  chart?.dispose()
  chart = null
})

watch(() => [props.data, props.mode, props.theme], render)
</script>

<template>
  <div ref="container" class="treemap-chart" />
</template>
