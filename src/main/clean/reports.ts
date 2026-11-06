import type { CleanReport } from '@shared/types'

const reports = new Map<string, CleanReport>()

export function putCleanReport(report: CleanReport): void {
  reports.set(report.taskId, report)
  if (reports.size <= 10) return
  const oldest = reports.keys().next().value
  if (oldest) reports.delete(oldest)
}

export function getCleanReport(taskId: string): CleanReport | undefined {
  return reports.get(taskId)
}
