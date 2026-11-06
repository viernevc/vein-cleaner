import { randomUUID } from 'node:crypto'
import type { TaskEvent, TaskKind, TaskSnapshot, TaskState } from '@shared/types'
import { AbortError, toAppErrorInfo } from './errors'
import { log } from './logger'

interface ProgressPatch {
  phase?: string
  percent?: number | null
  done?: number
  total?: number | null
  bytesDone?: number
  bytesTotal?: number | null
  currentPath?: string
}

interface TaskRecord {
  id: string
  kind: TaskKind
  state: TaskState
  phase: string
  percent: number | null
  done: number
  total: number | null
  bytesDone: number
  bytesTotal: number | null
  currentPath?: string
  startedAt: number
  endedAt?: number
  controller: AbortController
  lastEmit: number
  flushTimer: NodeJS.Timeout | null
  result?: unknown
  error?: { code: string; message: string }
}

export type TaskRunner = (ctx: TaskContext) => Promise<unknown>
export type EventSink = (event: TaskEvent) => void

export class TaskContext {
  constructor(
    readonly taskId: string,
    readonly kind: TaskKind,
    private readonly controller: AbortController,
    private readonly report: (patch: ProgressPatch) => void
  ) {}

  get aborted(): boolean {
    return this.controller.signal.aborted
  }

  get signal(): AbortSignal {
    return this.controller.signal
  }

  checkAbort(): void {
    if (this.controller.signal.aborted) throw new AbortError()
  }

  progress(patch: ProgressPatch): void {
    this.report(patch)
  }
}

export class TaskManager {
  private readonly tasks = new Map<string, TaskRecord>()
  private sink: EventSink = () => undefined

  setSink(sink: EventSink): void {
    this.sink = sink
  }

  start(kind: TaskKind, runner: TaskRunner): string {
    const id = randomUUID()
    const rec: TaskRecord = {
      id,
      kind,
      state: 'queued',
      phase: '准备中',
      percent: 0,
      done: 0,
      total: null,
      bytesDone: 0,
      bytesTotal: null,
      startedAt: Date.now(),
      controller: new AbortController(),
      lastEmit: 0,
      flushTimer: null
    }
    this.tasks.set(id, rec)
    this.evict()

    const ctx = new TaskContext(id, kind, rec.controller, (patch) => this.report(rec, patch))

    // 让 invoke 先返回 taskId，再开始耗时工作
    setImmediate(() => {
      if (rec.controller.signal.aborted) {
        this.finishCancelled(rec)
        return
      }
      rec.state = 'running'
      this.emit({ type: 'state', taskId: id, state: 'running', phase: rec.phase })
      runner(ctx)
        .then((result) => {
          rec.result = result
          rec.state = 'done'
          rec.endedAt = Date.now()
          rec.percent = rec.percent === null ? null : 100
          this.clearFlush(rec)
          this.emitProgress(rec)
          this.emit({ type: 'done', taskId: id, result })
        })
        .catch((err: unknown) => {
          rec.endedAt = Date.now()
          if (err instanceof AbortError || rec.controller.signal.aborted) {
            this.finishCancelled(rec)
            return
          }
          rec.state = 'error'
          rec.error = toAppErrorInfo(err)
          this.clearFlush(rec)
          log('error', `任务失败 ${kind}`, rec.error)
          this.emit({ type: 'error', taskId: id, error: rec.error })
        })
    })

    return id
  }

  cancel(taskId: string): boolean {
    const rec = this.tasks.get(taskId)
    if (!rec) return false
    if (rec.state === 'done' || rec.state === 'error' || rec.state === 'cancelled') return true
    rec.state = 'cancelling'
    rec.controller.abort()
    this.emit({ type: 'state', taskId, state: 'cancelling' })
    return true
  }

  snapshot(): TaskSnapshot[] {
    return [...this.tasks.values()].map((rec) => ({
      taskId: rec.id,
      kind: rec.kind,
      state: rec.state,
      phase: rec.phase,
      percent: rec.percent,
      done: rec.done,
      total: rec.total,
      bytesDone: rec.bytesDone,
      bytesTotal: rec.bytesTotal,
      currentPath: rec.currentPath,
      startedAt: rec.startedAt,
      endedAt: rec.endedAt
    }))
  }

  private report(rec: TaskRecord, patch: ProgressPatch): void {
    if (patch.phase !== undefined) rec.phase = patch.phase
    if (patch.percent !== undefined) rec.percent = patch.percent
    if (patch.done !== undefined) rec.done = patch.done
    if (patch.total !== undefined) rec.total = patch.total
    if (patch.bytesDone !== undefined) rec.bytesDone = patch.bytesDone
    if (patch.bytesTotal !== undefined) rec.bytesTotal = patch.bytesTotal
    if (patch.currentPath !== undefined) rec.currentPath = patch.currentPath

    const now = Date.now()
    if (now - rec.lastEmit >= 120) {
      rec.lastEmit = now
      this.emitProgress(rec)
      return
    }
    if (!rec.flushTimer) {
      rec.flushTimer = setTimeout(() => {
        rec.flushTimer = null
        rec.lastEmit = Date.now()
        this.emitProgress(rec)
      }, 120)
    }
  }

  private finishCancelled(rec: TaskRecord): void {
    rec.state = 'cancelled'
    rec.endedAt = Date.now()
    this.clearFlush(rec)
    this.emit({ type: 'cancelled', taskId: rec.id })
  }

  private clearFlush(rec: TaskRecord): void {
    if (rec.flushTimer) {
      clearTimeout(rec.flushTimer)
      rec.flushTimer = null
    }
  }

  private emitProgress(rec: TaskRecord): void {
    this.emit({
      type: 'progress',
      taskId: rec.id,
      phase: rec.phase,
      percent: rec.percent,
      done: rec.done,
      total: rec.total,
      bytesDone: rec.bytesDone,
      bytesTotal: rec.bytesTotal,
      currentPath: rec.currentPath
    })
  }

  private emit(event: TaskEvent): void {
    try {
      this.sink(event)
    } catch (err) {
      log('warn', '发送任务事件失败', err)
    }
  }

  private evict(): void {
    if (this.tasks.size <= 30) return
    const finished = [...this.tasks.values()]
      .filter((t) => t.state === 'done' || t.state === 'error' || t.state === 'cancelled')
      .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))
    while (this.tasks.size > 30 && finished.length) {
      const rec = finished.shift()
      if (rec) this.tasks.delete(rec.id)
    }
  }
}

export const tasks = new TaskManager()
