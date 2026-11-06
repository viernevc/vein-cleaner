import type { DuplicateFile, DuplicateGroupSummary } from '@shared/types'

export interface DupFileRecord extends DuplicateFile {
  size: number
  ctimeMs: number
}

export interface DupGroupRecord {
  id: string
  size: number
  hash: string
  files: DupFileRecord[]
}

export interface DupSession {
  taskId: string
  roots: string[]
  groups: DupGroupRecord[]
  createdAt: number
}

const sessions = new Map<string, DupSession>()

export function putDupSession(session: DupSession): void {
  sessions.set(session.taskId, session)
  if (sessions.size <= 3) return
  const sorted = [...sessions.values()].sort((a, b) => a.createdAt - b.createdAt)
  while (sessions.size > 3 && sorted.length) {
    const oldest = sorted.shift()
    if (oldest) sessions.delete(oldest.taskId)
  }
}

export function getDupSession(taskId: string): DupSession | undefined {
  return sessions.get(taskId)
}

export function groupSummary(group: DupGroupRecord): DuplicateGroupSummary {
  return {
    id: group.id,
    size: group.size,
    count: group.files.length,
    wasted: group.size * Math.max(0, group.files.length - 1)
  }
}
