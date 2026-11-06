import { app } from 'electron'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { log } from '../core/logger'

export interface HashFile {
  id: string
  path: string
  size: number
}

function workerPath(): string {
  let p = path.join(__dirname, 'hash-worker.js')
  if (app.isPackaged && p.includes('app.asar')) {
    p = p.replace('app.asar', 'app.asar.unpacked')
  }
  return p
}

/**
 * 在 worker 线程池中计算哈希。
 * 返回 id -> hash；失败或取消的文件不出现在结果中。
 */
export async function hashFiles(
  files: HashFile[],
  mode: 'partial' | 'full',
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
  workerCount = Math.max(2, Math.min(8, Math.floor(os.cpus().length / 2)))
): Promise<Map<string, string>> {
  const results = new Map<string, string>()
  if (!files.length) return results

  const chunkSize = 16
  let next = 0
  let completed = 0

  return new Promise((resolve) => {
    const workers: Worker[] = []
    let settled = false
    let exited = 0

    const finish = (): void => {
      if (settled) return
      settled = true
      for (const w of workers) {
        void w.terminate()
      }
      resolve(results)
    }

    const dispatch = (worker: Worker): void => {
      if (settled) return
      if (signal.aborted) {
        finish()
        return
      }
      if (next >= files.length) {
        worker.postMessage({ type: 'stop' })
        return
      }
      const chunk = files.slice(next, next + chunkSize)
      next += chunk.length
      worker.postMessage({ type: 'hash', mode, files: chunk })
    }

    const onAbort = (): void => finish()
    signal.addEventListener('abort', onAbort, { once: true })

    for (let i = 0; i < workerCount; i++) {
      let worker: Worker
      try {
        worker = new Worker(workerPath())
      } catch (err) {
        log('error', '创建哈希 worker 失败', err)
        continue
      }
      workers.push(worker)
      worker.on('message', (msg: { type: string; id?: string; hash?: string }) => {
        if (msg.type === 'result' && msg.id && msg.hash) {
          results.set(msg.id, msg.hash)
          completed++
          onProgress(completed, files.length)
        } else if (msg.type === 'error') {
          completed++
          onProgress(completed, files.length)
        } else if (msg.type === 'batch-done') {
          dispatch(worker)
        }
        if (completed >= files.length) finish()
      })
      worker.on('error', (err) => {
        log('error', '哈希 worker 异常', err)
        dispatch(worker)
      })
      worker.on('exit', () => {
        exited++
        if (exited >= workers.length && !settled) finish()
      })
      dispatch(worker)
    }

    if (!workers.length) {
      finish()
      return
    }
    if (signal.aborted) finish()
  })
}
