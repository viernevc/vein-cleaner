/** IPC 通道名集中定义 */
export const IPC = {
  appState: 'app:state',
  appRelaunchElevated: 'app:relaunch-elevated',
  appResumeAck: 'app:resume-ack',
  appShowItem: 'app:show-item',
  appOpenExternal: 'app:open-external',

  rulesList: 'rules:list',

  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsSetLogDir: 'settings:set-log-dir',

  cleanScan: 'clean:scan',
  cleanRun: 'clean:run',
  cleanEntries: 'clean:entries',
  cleanReport: 'clean:report',

  analyzeDrives: 'analyze:drives',
  analyzeScan: 'analyze:scan',
  analyzeChildren: 'analyze:children',
  analyzeTreemap: 'analyze:treemap',
  analyzeTopFiles: 'analyze:top-files',

  dupScan: 'dup:scan',
  dupGroups: 'dup:groups',
  dupGroup: 'dup:group',
  dupRemove: 'dup:remove',

  taskCancel: 'task:cancel',
  taskSnapshot: 'task:snapshot',
  taskEvent: 'task:event',

  winControl: 'win:control',
  winMaximized: 'win:maximized',

  dialogPickFolder: 'dialog:pick-folder'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
