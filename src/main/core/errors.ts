import type { AppErrorInfo } from '@shared/types'

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class AbortError extends Error {
  constructor(message = '任务已取消') {
    super(message)
    this.name = 'AbortError'
  }
}

const FS_ERROR_TEXT: Record<string, string> = {
  EACCES: '无权限访问',
  EPERM: '无权限访问或被占用',
  EBUSY: '文件被占用',
  ENOENT: '文件已不存在',
  ENAMETOOLONG: '路径过长',
  ELOOP: '存在符号链接循环',
  ENOTEMPTY: '目录非空',
  EROFS: '只读文件系统',
  ENOSPC: '磁盘空间不足',
  EMFILE: '打开文件过多'
}

export function fsErrorInfo(err: unknown): { code: string; message: string } {
  const e = err as NodeJS.ErrnoException
  const code = e?.code || 'E_UNKNOWN'
  return { code, message: FS_ERROR_TEXT[code] || e?.message || '未知错误' }
}

export function toAppErrorInfo(err: unknown, fallbackCode = 'E_UNKNOWN'): AppErrorInfo {
  if (err instanceof AppError) return { code: err.code, message: err.message }
  if (err instanceof AbortError) return { code: 'E_CANCELLED', message: err.message }
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code
    return { code: code || fallbackCode, message: err.message }
  }
  return { code: fallbackCode, message: String(err) }
}
