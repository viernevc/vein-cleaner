import { parentPort } from 'node:worker_threads'
import { fullHash, partialHash } from '../fs/hash'

interface HashJob {
  type: 'hash'
  mode: 'partial' | 'full'
  files: Array<{ id: string; path: string; size: number }>
}

type Incoming = HashJob | { type: 'stop' }

if (!parentPort) {
  throw new Error('hash-worker 必须在 worker_threads 中运行')
}

parentPort.on('message', async (msg: Incoming) => {
  if (msg.type === 'stop') {
    process.exit(0)
    return
  }
  if (msg.type !== 'hash') return

  for (const file of msg.files) {
    try {
      const hash = msg.mode === 'partial' ? await partialHash(file.path, file.size) : await fullHash(file.path)
      parentPort?.postMessage({ type: 'result', id: file.id, hash })
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      parentPort?.postMessage({
        type: 'error',
        id: file.id,
        code: e.code || 'E_HASH',
        message: e.message || '哈希计算失败'
      })
    }
  }
  parentPort?.postMessage({ type: 'batch-done' })
})
