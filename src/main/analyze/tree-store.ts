import path from 'node:path'
import type { TreeNode, TreemapNode } from '@shared/types'
import { normKey } from '../core/paths'

export const MAX_NODE_DEPTH = 10
export const NODE_CAP = 80000

interface DirRecord {
  key: string
  path: string
  name: string
  size: number
  fileCount: number
  dirCount: number
  children: Map<string, DirRecord>
}

const bySizeDesc = (a: DirRecord, b: DirRecord): number => b.size - a.size

export class TreeStore {
  readonly nodes = new Map<string, DirRecord>()
  readonly root: DirRecord
  truncated = false
  totalBytes = 0
  totalFiles = 0
  totalDirs = 0

  constructor(rootPath: string) {
    const key = normKey(rootPath)
    this.root = {
      key,
      path: rootPath,
      name: rootPath,
      size: 0,
      fileCount: 0,
      dirCount: 0,
      children: new Map()
    }
    this.nodes.set(key, this.root)
  }

  /** 为新目录创建记录；父节点不存在、超深或超量时返回 null */
  ensureDir(dirPath: string, name: string, depth: number): DirRecord | null {
    const key = normKey(dirPath)
    const existing = this.nodes.get(key)
    if (existing) return existing
    if (depth > MAX_NODE_DEPTH) return null
    if (this.nodes.size >= NODE_CAP) {
      this.truncated = true
      return null
    }
    const parent = this.nodes.get(normKey(path.win32.dirname(dirPath)))
    if (!parent) return null
    const rec: DirRecord = {
      key,
      path: dirPath,
      name,
      size: 0,
      fileCount: 0,
      dirCount: 0,
      children: new Map()
    }
    this.nodes.set(key, rec)
    parent.children.set(key, rec)
    return rec
  }

  /** 每个目录都会调用（即使未创建记录），用于父级 dirCount 统计 */
  countDir(dirPath: string): void {
    this.totalDirs++
    let current = path.win32.dirname(dirPath)
    let guard = 0
    while (guard++ < 64) {
      const rec = this.nodes.get(normKey(current))
      if (rec) rec.dirCount++
      if (normKey(current) === this.root.key) break
      const parent = path.win32.dirname(current)
      if (parent === current) break
      current = parent
    }
  }

  /** 每个文件都会调用，累加到所有已建记录的祖先目录 */
  addFile(filePath: string, size: number): void {
    this.totalBytes += size
    this.totalFiles++
    let current = path.win32.dirname(filePath)
    let guard = 0
    while (guard++ < 64) {
      const rec = this.nodes.get(normKey(current))
      if (rec) {
        rec.size += size
        rec.fileCount++
      }
      if (normKey(current) === this.root.key) break
      const parent = path.win32.dirname(current)
      if (parent === current) break
      current = parent
    }
  }

  toTreeNode(rec: DirRecord): TreeNode {
    return {
      path: rec.path,
      name: rec.name,
      size: rec.size,
      fileCount: rec.fileCount,
      dirCount: rec.dirCount,
      hasChildren: rec.children.size > 0
    }
  }

  childrenPage(dirPath: string, offset: number, limit: number): { items: TreeNode[]; total: number } {
    const rec = this.nodes.get(normKey(dirPath))
    if (!rec) return { items: [], total: 0 }
    const children = [...rec.children.values()].sort(bySizeDesc)
    const items = children.slice(offset, offset + limit).map((c) => this.toTreeNode(c))
    return { items, total: children.length }
  }

  buildTreemap(
    dirPath: string,
    depth: number,
    maxChildren: number
  ): TreemapNode | null {
    const rec = this.nodes.get(normKey(dirPath))
    if (!rec) return null

    const build = (node: DirRecord, level: number): TreemapNode => {
      const base: TreemapNode = { name: node.name, path: node.path, value: node.size }
      if (level >= depth || node.children.size === 0) return base
      const children = [...node.children.values()].sort(bySizeDesc)
      const top = children.slice(0, maxChildren)
      const rest = children.slice(maxChildren)
      const result = top.map((child) => build(child, level + 1))
      if (rest.length) {
        const restSize = rest.reduce((sum, c) => sum + c.size, 0)
        if (restSize > 0) {
          result.push({ name: `其他 ${rest.length} 项`, path: node.path, value: restSize })
        }
      }
      if (result.length) base.children = result
      return base
    }

    return build(rec, 0)
  }
}
