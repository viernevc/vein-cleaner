import type { RuleGroup, RuleMeta, RuleSpecial, Safety } from '@shared/types'

export interface RuleTarget {
  /** 支持 %ENV% 白名单环境变量与一层 * 通配（用于浏览器 profile） */
  template: string
  recursive: boolean
  filePatterns?: string[]
  excludePatterns?: string[]
  minAgeDays?: number
  /** 使用设置中的下载目录天数 */
  ageFromSettings?: boolean
  /** true = 连根目录一起删除；默认 false = 清空内容保留根目录 */
  removeRoot?: boolean
}

export interface CleanRule {
  id: string
  group: RuleGroup
  name: string
  description: string
  safety: Safety
  adminRequired: boolean
  defaultEnabled: boolean
  deleteMode: 'permanent' | 'recycle' | 'special'
  special?: RuleSpecial
  services?: string[]
  processGuard?: string[]
  lockHint?: string
  targets: RuleTarget[]
}

/** 规则表是唯一可删除路径来源，渲染进程只能拿到元数据 */
export const CLEAN_RULES: CleanRule[] = [
  {
    id: 'user-temp',
    group: 'system',
    name: '用户临时文件',
    description: '当前用户临时目录（%TEMP%），应用程序与安装程序运行中产生的临时文件。',
    safety: 'low',
    adminRequired: false,
    defaultEnabled: true,
    deleteMode: 'permanent',
    lockHint: '正在被运行中的程序使用的临时文件会自动跳过。',
    targets: [{ template: '%TEMP%', recursive: true }]
  },
  {
    id: 'windows-temp',
    group: 'system',
    name: 'Windows 临时文件',
    description: '系统级临时目录（Windows\\Temp），通常由系统服务和安装程序产生。',
    safety: 'low',
    adminRequired: true,
    defaultEnabled: true,
    deleteMode: 'permanent',
    lockHint: '部分文件被系统服务占用时会跳过。',
    targets: [{ template: '%WINDIR%\\Temp', recursive: true }]
  },
  {
    id: 'chrome-cache',
    group: 'browser',
    name: 'Chrome 缓存',
    description: 'Chrome 各用户配置的网页缓存、代码缓存、GPU 缓存与 Service Worker 缓存，不影响书签、密码与登录状态。',
    safety: 'low',
    adminRequired: false,
    defaultEnabled: true,
    deleteMode: 'permanent',
    processGuard: ['chrome.exe'],
    lockHint: 'Chrome 运行中时缓存文件可能被占用。',
    targets: [
      { template: '%LOCALAPPDATA%\\Google\\Chrome\\User Data\\*\\Cache\\Cache_Data', recursive: true },
      { template: '%LOCALAPPDATA%\\Google\\Chrome\\User Data\\*\\Code Cache', recursive: true },
      { template: '%LOCALAPPDATA%\\Google\\Chrome\\User Data\\*\\GPUCache', recursive: true },
      { template: '%LOCALAPPDATA%\\Google\\Chrome\\User Data\\*\\Service Worker\\CacheStorage', recursive: true }
    ]
  },
  {
    id: 'edge-cache',
    group: 'browser',
    name: 'Edge 缓存',
    description: 'Microsoft Edge 各用户配置的网页缓存、代码缓存与 GPU 缓存，不影响收藏夹与登录状态。',
    safety: 'low',
    adminRequired: false,
    defaultEnabled: true,
    deleteMode: 'permanent',
    processGuard: ['msedge.exe'],
    lockHint: 'Edge 运行中时缓存文件可能被占用。',
    targets: [
      { template: '%LOCALAPPDATA%\\Microsoft\\Edge\\User Data\\*\\Cache\\Cache_Data', recursive: true },
      { template: '%LOCALAPPDATA%\\Microsoft\\Edge\\User Data\\*\\Code Cache', recursive: true },
      { template: '%LOCALAPPDATA%\\Microsoft\\Edge\\User Data\\*\\GPUCache', recursive: true },
      { template: '%LOCALAPPDATA%\\Microsoft\\Edge\\User Data\\*\\Service Worker\\CacheStorage', recursive: true }
    ]
  },
  {
    id: 'firefox-cache',
    group: 'browser',
    name: 'Firefox 缓存',
    description: 'Firefox 配置目录下的网页缓存与启动缓存，不影响历史记录与登录状态。',
    safety: 'low',
    adminRequired: false,
    defaultEnabled: true,
    deleteMode: 'permanent',
    processGuard: ['firefox.exe'],
    lockHint: 'Firefox 运行中时缓存文件可能被占用。',
    targets: [
      { template: '%LOCALAPPDATA%\\Mozilla\\Firefox\\Profiles\\*\\cache2', recursive: true },
      { template: '%LOCALAPPDATA%\\Mozilla\\Firefox\\Profiles\\*\\startupCache', recursive: true }
    ]
  },
  {
    id: 'recycle-bin',
    group: 'recycle',
    name: '回收站',
    description: '清空所有驱动器回收站。此操作不可恢复，请确认其中没有需要保留的文件。',
    safety: 'high',
    adminRequired: false,
    defaultEnabled: true,
    deleteMode: 'special',
    special: 'recycle-bin',
    targets: []
  },
  {
    id: 'windows-update',
    group: 'system',
    name: 'Windows Update 残留',
    description: '系统更新下载缓存（SoftwareDistribution\\Download）。清理时会临时停止更新服务并在完成后自动恢复。',
    safety: 'medium',
    adminRequired: true,
    defaultEnabled: true,
    deleteMode: 'special',
    special: 'windows-update',
    services: ['wuauserv', 'bits', 'dosvc'],
    lockHint: '更新服务占用时会在停止服务后清理并自动恢复。',
    targets: [{ template: '%WINDIR%\\SoftwareDistribution\\Download', recursive: true }]
  },
  {
    id: 'delivery-optimization',
    group: 'system',
    name: '传递优化缓存',
    description: 'Windows 更新分发使用的传递优化（Delivery Optimization）下载缓存。',
    safety: 'medium',
    adminRequired: true,
    defaultEnabled: true,
    deleteMode: 'permanent',
    targets: [
      {
        template:
          '%WINDIR%\\ServiceProfiles\\NetworkService\\AppData\\Local\\Microsoft\\Windows\\DeliveryOptimization',
        recursive: true
      }
    ]
  },
  {
    id: 'thumb-cache',
    group: 'system',
    name: '缩略图与图标缓存',
    description: '资源管理器生成的缩略图与图标缓存（thumbcache/iconcache），删除后会自动重建。',
    safety: 'low',
    adminRequired: false,
    defaultEnabled: true,
    deleteMode: 'permanent',
    lockHint: '资源管理器占用的缓存文件会被跳过，重新打开文件夹后会重建。',
    targets: [
      {
        template: '%LOCALAPPDATA%\\Microsoft\\Windows\\Explorer',
        recursive: false,
        filePatterns: ['thumbcache_*.db', 'iconcache_*.db']
      }
    ]
  },
  {
    id: 'font-cache',
    group: 'system',
    name: '字体缓存',
    description: 'Windows 字体缓存目录。清理时会临时停止字体缓存服务并在完成后恢复。',
    safety: 'medium',
    adminRequired: true,
    defaultEnabled: true,
    deleteMode: 'special',
    special: 'font-cache',
    services: ['FontCache', 'FontCache3.0.0.0'],
    lockHint: '字体缓存服务占用时会在停止服务后清理并自动恢复。',
    targets: [
      {
        template: '%WINDIR%\\ServiceProfiles\\LocalService\\AppData\\Local\\FontCache',
        recursive: true
      }
    ]
  },
  {
    id: 'wer-user',
    group: 'system',
    name: '用户错误报告与崩溃转储',
    description: '当前用户的 Windows 错误报告（WER）与崩溃转储文件。',
    safety: 'medium',
    adminRequired: false,
    defaultEnabled: true,
    deleteMode: 'permanent',
    targets: [
      { template: '%LOCALAPPDATA%\\CrashDumps', recursive: true },
      { template: '%LOCALAPPDATA%\\Microsoft\\Windows\\WER', recursive: true }
    ]
  },
  {
    id: 'wer-system',
    group: 'system',
    name: '系统错误报告',
    description: '系统级 Windows 错误报告归档与队列。',
    safety: 'medium',
    adminRequired: true,
    defaultEnabled: true,
    deleteMode: 'permanent',
    targets: [{ template: '%PROGRAMDATA%\\Microsoft\\Windows\\WER', recursive: true }]
  },
  {
    id: 'crash-dumps',
    group: 'system',
    name: '系统内存转储',
    description: 'Windows 蓝屏产生的小型内存转储（Minidump），仅在排查系统故障时需要保留。',
    safety: 'medium',
    adminRequired: true,
    defaultEnabled: true,
    deleteMode: 'permanent',
    targets: [{ template: '%WINDIR%\\Minidump', recursive: true }]
  },
  {
    id: 'inet-cache',
    group: 'system',
    name: 'IE/系统网络缓存',
    description: '系统级 Internet 缓存（INetCache），由 IE 及部分使用 WinINet 的程序产生。',
    safety: 'low',
    adminRequired: false,
    defaultEnabled: true,
    deleteMode: 'permanent',
    targets: [{ template: '%LOCALAPPDATA%\\Microsoft\\Windows\\INetCache', recursive: true }]
  },
  {
    id: 'windows-logs',
    group: 'system',
    name: 'Windows 日志（7 天前）',
    description: 'Windows 目录下 7 天前的日志文件，保留近期日志便于排障。',
    safety: 'medium',
    adminRequired: true,
    defaultEnabled: false,
    deleteMode: 'permanent',
    targets: [{ template: '%WINDIR%\\Logs', recursive: true, minAgeDays: 7 }]
  },
  {
    id: 'prefetch',
    group: 'system',
    name: '预读取文件',
    description: 'Prefetch 预读取数据，清理后系统会自动重建，短期内可能轻微影响程序启动速度。',
    safety: 'low',
    adminRequired: true,
    defaultEnabled: false,
    deleteMode: 'permanent',
    targets: [{ template: '%WINDIR%\\Prefetch', recursive: true }]
  },
  {
    id: 'downloads-old',
    group: 'user',
    name: '下载目录旧文件',
    description: '下载目录中超过指定天数未修改的文件，将移动到回收站，可在回收站中恢复。',
    safety: 'high',
    adminRequired: false,
    defaultEnabled: false,
    deleteMode: 'recycle',
    lockHint: '正在下载的文件（.crdownload）会被排除。',
    targets: [
      {
        template: '%USERPROFILE%\\Downloads',
        recursive: true,
        ageFromSettings: true,
        excludePatterns: ['*.crdownload', '*.part']
      }
    ]
  },
  {
    id: 'recent-items',
    group: 'user',
    name: '最近使用记录',
    description: 'Windows 最近打开文件与跳转列表记录，属于隐私清理项。',
    safety: 'medium',
    adminRequired: false,
    defaultEnabled: false,
    deleteMode: 'permanent',
    targets: [{ template: '%APPDATA%\\Microsoft\\Windows\\Recent', recursive: true }]
  }
]

export function ruleMeta(rule: CleanRule): RuleMeta {
  return {
    id: rule.id,
    group: rule.group,
    name: rule.name,
    description: rule.description,
    safety: rule.safety,
    adminRequired: rule.adminRequired,
    defaultEnabled: rule.defaultEnabled,
    special: rule.special,
    lockHint: rule.lockHint
  }
}

export function findRule(id: string): CleanRule | undefined {
  return CLEAN_RULES.find((r) => r.id === id)
}
