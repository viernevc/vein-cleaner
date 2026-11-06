import type { VeinApi } from '@shared/types'

declare global {
  interface Window {
    vein: VeinApi
  }
}

export {}
