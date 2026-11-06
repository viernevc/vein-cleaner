import type { ResumeTask } from '@shared/types'

let resumeTask: ResumeTask | null = null

export function setResumeTask(task: ResumeTask | null): void {
  resumeTask = task
}

export function peekResumeTask(): ResumeTask | null {
  return resumeTask
}

export function consumeResumeTask(token: string): boolean {
  if (!resumeTask || resumeTask.token !== token) return false
  resumeTask = null
  return true
}
