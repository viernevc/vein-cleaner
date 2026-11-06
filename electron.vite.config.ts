import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@main': resolve('src/main')
      }
    },
    build: {
      outDir: 'build/main',
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'hash-worker': resolve('src/main/duplicates/hash-worker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      outDir: 'build/preload'
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@components': resolve('src/renderer/src/components'),
        '@store': resolve('src/renderer/src/stores'),
        '@composables': resolve('src/renderer/src/composables'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [
      vue(),
      AutoImport({
        imports: ['vue', 'pinia'],
        dts: resolve('src/renderer/src/auto-imports.d.ts'),
        vueTemplate: true
      }),
      Components({
        dirs: [
          resolve('src/renderer/src/components'),
          resolve('src/renderer/src/layouts')
        ],
        resolvers: [ElementPlusResolver({ importStyle: false })],
        dts: resolve('src/renderer/src/components.d.ts')
      })
    ],
    build: {
      outDir: 'build/renderer'
    }
  }
})
