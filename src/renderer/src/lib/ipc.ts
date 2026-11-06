import type { IpcResult } from '@shared/types'

/** 解包 IPC 信封，失败时抛出带用户文案的 Error */
export async function unwrap<T>(promise: Promise<IpcResult<T>>): Promise<T> {
  const result = await promise
  if (!result.ok) {
    throw new Error(result.error.message || result.error.code || '操作失败')
  }
  return result.data
}

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
