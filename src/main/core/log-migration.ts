import fs from 'node:fs'
import path from 'node:path'

export interface MigrateResult {
  moved: string[]
  failed: string[]
}

/** 将日志文件从 fromDir 迁移到 toDir；目标同名文件存在时追加，避免覆盖历史 */
export function migrateLogFiles(fromDir: string, toDir: string): MigrateResult {
  const moved: string[] = []
  const failed: string[] = []
  if (!fromDir || !toDir) return { moved, failed }
  if (path.resolve(fromDir).toLowerCase() === path.resolve(toDir).toLowerCase()) {
    return { moved, failed }
  }

  for (const name of ['vein.log', 'vein.old.log']) {
    const source = path.join(fromDir, name)
    if (!fs.existsSync(source)) continue
    const target = path.join(toDir, name)

    try {
      if (fs.existsSync(target)) {
        fs.appendFileSync(target, fs.readFileSync(source))
        fs.unlinkSync(source)
      } else {
        try {
          fs.renameSync(source, target)
        } catch {
          // 跨盘符时 rename 会失败，退化为复制后删除
          fs.copyFileSync(source, target)
          fs.unlinkSync(source)
        }
      }
      moved.push(name)
    } catch {
      failed.push(name)
    }
  }

  return { moved, failed }
}
