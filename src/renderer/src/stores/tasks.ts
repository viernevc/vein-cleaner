import { unwrap } from '../lib/ipc'
import type { TaskEvent, TaskSnapshot } from '@shared/types'

interface Waiter {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
}

function terminal(state: TaskSnapshot['state']): boolean {
  return state === 'done' || state === 'error' || state === 'cancelled'
}

export const useTaskStore = defineStore('tasks', () => {
  const tasks = reactive<Record<string, TaskSnapshot>>({})
  const results = new Map<string, unknown>()
  const errors = new Map<string, Error>()
  const waiters = new Map<string, Waiter>()
  let bound = false

  function ingest(event: TaskEvent): void {
    const prev: TaskSnapshot =
      tasks[event.taskId] ??
      ({
        taskId: event.taskId,
        kind: 'clean.scan',
        state: 'queued',
        phase: '准备中',
        percent: 0,
        done: 0,
        total: null,
        bytesDone: 0,
        bytesTotal: null,
        startedAt: Date.now()
      } as TaskSnapshot)

    if (event.type === 'state') {
      tasks[event.taskId] = { ...prev, state: event.state, phase: event.phase ?? prev.phase }
      return
    }

    if (event.type === 'progress') {
      tasks[event.taskId] = {
        ...prev,
        state: prev.state === 'queued' ? 'running' : prev.state,
        phase: event.phase,
        percent: event.percent,
        done: event.done,
        total: event.total,
        bytesDone: event.bytesDone,
        bytesTotal: event.bytesTotal,
        currentPath: event.currentPath
      }
      return
    }

    if (event.type === 'done') {
      tasks[event.taskId] = {
        ...prev,
        state: 'done',
        percent: prev.percent === null ? null : 100,
        endedAt: Date.now()
      }
      results.set(event.taskId, event.result)
      waiters.get(event.taskId)?.resolve(event.result)
      waiters.delete(event.taskId)
      return
    }

    if (event.type === 'error') {
      const error = new Error(event.error.message || event.error.code)
      tasks[event.taskId] = { ...prev, state: 'error', endedAt: Date.now() }
      errors.set(event.taskId, error)
      waiters.get(event.taskId)?.reject(error)
      waiters.delete(event.taskId)
      return
    }

    tasks[event.taskId] = { ...prev, state: 'cancelled', endedAt: Date.now() }
    const cancelError = new Error('任务已取消')
    errors.set(event.taskId, cancelError)
    waiters.get(event.taskId)?.reject(cancelError)
    waiters.delete(event.taskId)
  }

  function bind(): void {
    if (bound) return
    bound = true
    window.vein.tasks.onEvent(ingest)
    void sync()
  }

  async function sync(): Promise<void> {
    try {
      const list = await unwrap(window.vein.tasks.snapshot())
      for (const snapshot of list) {
        if (!tasks[snapshot.taskId] || !terminal(tasks[snapshot.taskId].state)) {
          tasks[snapshot.taskId] = snapshot
        }
      }
    } catch {
      // 快照恢复失败不影响主流程
    }
  }

  function waitFor<T>(taskId: string): Promise<T> {
    if (results.has(taskId)) return Promise.resolve(results.get(taskId) as T)
    if (errors.has(taskId)) return Promise.reject(errors.get(taskId))
    const known = tasks[taskId]
    if (known && terminal(known.state)) {
      if (known.state === 'done') {
        return Promise.resolve(undefined as T)
      }
      return Promise.reject(new Error('任务已结束'))
    }
    return new Promise<T>((resolve, reject) => {
      waiters.set(taskId, {
        resolve: resolve as (value: unknown) => void,
        reject
      })
    })
  }

  async function cancel(taskId: string): Promise<void> {
    try {
      await unwrap(window.vein.tasks.cancel({ taskId }))
    } catch {
      // 忽略取消失败
    }
  }

  function get(taskId: string | null): TaskSnapshot | null {
    return taskId ? (tasks[taskId] ?? null) : null
  }

  return { tasks, bind, sync, waitFor, cancel, get }
})
