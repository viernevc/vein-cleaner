import type { ThemeMode } from '@shared/types'

/** 实际应用到 html 上的主题（green 为护眼绿） */
export type AppliedTheme = 'dark' | 'light' | 'green'
/** 配色方案，供图表等只区分明暗的场景使用 */
export type EffectiveTheme = 'dark' | 'light'

export function resolveTheme(theme: ThemeMode | string): AppliedTheme {
  if (theme === 'green') return 'green'
  if (theme === 'light') return 'light'
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'dark'
}

export function resolveScheme(theme: ThemeMode | string): EffectiveTheme {
  return resolveTheme(theme) === 'dark' ? 'dark' : 'light'
}

export function applyThemeClass(theme: AppliedTheme): void {
  const el = document.documentElement
  el.classList.toggle('dark', theme === 'dark')
  el.setAttribute('data-theme', theme)
}
