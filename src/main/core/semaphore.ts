import os from 'node:os'
import { AbortError } from './errors'

interface Waiter {
  resolve: () => void
  reject: (err: unknown) => void
  signal: AbortSignal
  onAbort: () => void
}

/** 可取消的并发信号量 */
export class Semaphore {
  private free: number
  private readonly queue: Waiter[] = []

  constructor(limit: number) {
    this.free = Math.max(1, Math.floor(limit))
  }

  async run<T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
    await this.acquire(signal)
    try {
      return await fn()
    } finally {
      this.release()
    }
  }

  private acquire(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new AbortError())
    if (this.free > 0) {
      this.free--
      return Promise.resolve()
    }

    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        const idx = this.queue.findIndex((w) => w.onAbort === onAbort)
        if (idx >= 0) this.queue.splice(idx, 1)
        reject(new AbortError())
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.queue.push({ resolve, reject, signal, onAbort })
    })
  }

  private release(): void {
    const next = this.queue.shift()
    if (!next) {
      this.free++
      return
    }
    next.signal.removeEventListener('abort', next.onAbort)
    next.resolve()
  }
}

export function defaultConcurrency(slowMode: boolean): number {
  const cpus = os.cpus().length
  if (slowMode) return 8
  return Math.max(16, Math.min(64, cpus * 4))
}
