import path from 'node:path'

const EXT_PREFIX = '\\\\?\\'
const EXT_UNC_PREFIX = '\\\\?\\UNC\\'

/** 仅允许展开这些环境变量，防止模板被意外指向系统敏感目录 */
const ENV_WHITELIST = new Set([
  'TEMP',
  'TMP',
  'LOCALAPPDATA',
  'APPDATA',
  'USERPROFILE',
  'PROGRAMDATA',
  'WINDIR',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'PUBLIC'
])

/** 展开 %VAR% 模板；非法或不在白名单时返回 null */
export function expandEnv(template: string): string | null {
  if (template.includes('..')) return null

  let failed = false
  const expanded = template.replace(/%([^%]+)%/g, (_m, rawName: string) => {
    const name = rawName.toUpperCase()
    if (!ENV_WHITELIST.has(name)) {
      failed = true
      return ''
    }
    const key = Object.keys(process.env).find((k) => k.toUpperCase() === name)
    const value = key ? process.env[key] : undefined
    if (!value) {
      failed = true
      return ''
    }
    return value
  })

  if (failed) return null
  const normalized = path.win32.normalize(expanded)
  if (!path.win32.isAbsolute(normalized)) return null
  return normalized.replace(/[\\/]+$/, '') || normalized
}

/** 将普通绝对路径转换为 Node fs 可识别超长路径的 \\?\ 形式 */
export function toExtended(p: string): string {
  if (p.startsWith(EXT_PREFIX)) return p
  const abs = path.win32.resolve(p)

  // 盘符根目录不能加 \\?\ 前缀：libuv 会将其误判为驱动器相对路径（EISDIR）
  if (/^[a-zA-Z]:\\?$/.test(abs)) {
    return abs.endsWith('\\') ? abs : abs + '\\'
  }

  if (abs.startsWith('\\\\')) {
    // 短 UNC 路径无需扩展前缀；超长路径才使用 \\?\UNC\ 形式
    if (abs.length < 240) return abs
    return EXT_UNC_PREFIX + abs.slice(2)
  }
  return EXT_PREFIX + abs
}

/** 去掉 \\?\ 前缀，用于展示与 shell 调用 */
export function toDisplay(p: string): string {
  if (p.startsWith(EXT_UNC_PREFIX)) return '\\\\' + p.slice(EXT_UNC_PREFIX.length)
  if (p.startsWith(EXT_PREFIX)) return p.slice(EXT_PREFIX.length)
  return p
}

/** 规范化比较键：小写、统一分隔符、去尾部分隔符 */
export function normKey(p: string): string {
  const display = toDisplay(p)
  const normalized = path.win32.normalize(display).replace(/[\\/]+$/, '')
  return normalized.toLowerCase()
}

/** child 是否位于 root 内（含等于） */
export function isInside(child: string, root: string): boolean {
  const c = normKey(child)
  const r = normKey(root)
  if (c === r) return true
  return c.startsWith(r.endsWith('\\') ? r : r + '\\')
}

/** 关键系统/用户目录保护名单 */
function protectedExactRoots(): string[] {
  const env = process.env
  const roots = [
    env.WINDIR,
    env.SystemRoot,
    env.USERPROFILE,
    env.APPDATA,
    env.LOCALAPPDATA,
    env.PROGRAMDATA,
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    env.SystemDrive ? `${env.SystemDrive}\\` : undefined
  ].filter(Boolean) as string[]
  return roots
}

function protectedSubtrees(): string[] {
  const env = process.env
  const roots: string[] = []
  if (env.WINDIR) {
    roots.push(
      ...['System32', 'SysWOW64', 'WinSxS', 'Fonts', 'assembly', 'Boot', 'servicing'].map((s) =>
        path.win32.join(env.WINDIR as string, s)
      )
    )
  }
  if (env.SystemDrive) {
    roots.push(
      path.win32.join(`${env.SystemDrive}\\`, 'System Volume Information'),
      path.win32.join(`${env.SystemDrive}\\`, '$Recycle.Bin')
    )
  }
  if (env.USERPROFILE) {
    roots.push(
      ...['Desktop', 'Documents', 'Pictures', 'Videos', 'Music', 'OneDrive', '.ssh', '.gnupg'].map(
        (s) => path.win32.join(env.USERPROFILE as string, s)
      )
    )
  }
  return roots
}

/**
 * 删除守卫：等于受保护根目录，或位于敏感子树内，则拒绝。
 * 注意：Windows\Temp、Windows\Logs 等清理目标不在敏感子树内。
 */
export function isProtectedPath(target: string): boolean {
  const key = normKey(target)
  if (protectedExactRoots().some((root) => normKey(root) === key)) return true
  return protectedSubtrees().some((root) => isInside(target, root))
}

/**
 * 将含一层通配符的模板展开为实际路径列表。
 * 仅支持 `*`，且一次只枚举一个通配段。
 */
export async function expandWildcard(template: string): Promise<string[]> {
  const segments = template.split(/[\\/]+/).filter(Boolean)
  let current: string[] = [segments[0].endsWith(':') ? `${segments[0]}\\` : segments[0]]

  const fs = await import('node:fs/promises')
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i]
    if (!seg.includes('*')) {
      current = current.map((base) => path.win32.join(base, seg))
      continue
    }
    const next: string[] = []
    const re = new RegExp('^' + seg.split('*').map(escapeRegExp).join('.*') + '$', 'i')
    for (const base of current) {
      try {
        const entries = await fs.readdir(toExtended(base), { withFileTypes: true })
        for (const ent of entries) {
          if (ent.isDirectory() && re.test(ent.name)) next.push(path.win32.join(base, ent.name))
        }
      } catch {
        // 目录不存在或无权限，跳过
      }
    }
    current = next
  }
  return current
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 简单文件名单通配匹配：支持 * 与 ?，大小写不敏感 */
export function matchPattern(name: string, pattern: string): boolean {
  const re = new RegExp(
    '^' +
      pattern
        .split('')
        .map((ch) => {
          if (ch === '*') return '.*'
          if (ch === '?') return '.'
          return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        })
        .join('') +
      '$',
    'i'
  )
  return re.test(name)
}
