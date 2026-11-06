import { ipcMain } from 'electron'
import type { IpcResult } from '@shared/types'
import { AppError, toAppErrorInfo } from '../core/errors'
import { log } from '../core/logger'

let trustedWebContentsId: number | null = null

export function setTrustedWebContents(id: number): void {
  trustedWebContentsId = id
}

/** 注册 invoke handler，统一校验来源并返回 { ok, data | error } 信封 */
export function handle<TInput, TOutput>(
  channel: string,
  fn: (input: TInput, senderId: number) => Promise<TOutput> | TOutput
): void {
  ipcMain.handle(channel, async (event, raw): Promise<IpcResult<TOutput>> => {
    try {
      if (trustedWebContentsId !== null && event.sender.id !== trustedWebContentsId) {
        throw new AppError('E_FORBIDDEN', '非法请求来源')
      }
      const data = await fn((raw ?? {}) as TInput, event.sender.id)
      return { ok: true, data }
    } catch (err) {
      log('error', `IPC ${channel} 失败`, err)
      return { ok: false, error: toAppErrorInfo(err) }
    }
  })
}

export function asString(value: unknown, name: string, maxLen = 32768): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLen) {
    throw new AppError('E_INVALID_INPUT', `参数 ${name} 非法`)
  }
  return value
}

export function asOptionalString(value: unknown, name: string, maxLen = 32768): string | undefined {
  if (value === undefined || value === null) return undefined
  return asString(value, name, maxLen)
}

export function asStringArray(value: unknown, name: string, maxItems = 100): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new AppError('E_INVALID_INPUT', `参数 ${name} 非法`)
  }
  return value.map((item) => asString(item, name, 32768))
}

export function asNumber(
  value: unknown,
  name: string,
  min: number,
  max: number,
  fallback: number
): number {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AppError('E_INVALID_INPUT', `参数 ${name} 非法`)
  }
  return Math.min(max, Math.max(min, value))
}

export function asEnum<T extends string>(
  value: unknown,
  name: string,
  allowed: readonly T[],
  fallback: T
): T {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new AppError('E_INVALID_INPUT', `参数 ${name} 非法`)
  }
  return value as T
}
