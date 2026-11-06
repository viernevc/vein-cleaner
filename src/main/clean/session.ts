import type { CleanEntry, RuleScanSummary } from '@shared/types'

export interface CleanEntryBucket {
  items: CleanEntry[]
  total: number
  truncated: boolean
}

export interface CleanSession {
  taskId: string
  createdAt: number
  ruleIds: string[]
  summaries: RuleScanSummary[]
  entries: Map<string, CleanEntryBucket>
  confirmToken: string
}

const sessions = new Map<string, CleanSession>()

export function putCleanSession(session: CleanSession): void {
  sessions.set(session.taskId, session)
  if (sessions.size <= 4) return
  const sorted = [...sessions.values()].sort((a, b) => a.createdAt - b.createdAt)
  while (sessions.size > 4 && sorted.length) {
    const oldest = sorted.shift()
    if (oldest) sessions.delete(oldest.taskId)
  }
}

export function getCleanSession(taskId: string): CleanSession | undefined {
  return sessions.get(taskId)
}
