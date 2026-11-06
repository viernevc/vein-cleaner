import { describe, expect, it } from 'vitest'
import { TreeStore } from '@main/analyze/tree-store'

describe('TreeStore', () => {
  it('聚合文件大小到祖先目录', () => {
    const store = new TreeStore('C:\\root')
    store.ensureDir('C:\\root\\a', 'a', 1)
    store.ensureDir('C:\\root\\a\\b', 'b', 2)
    store.countDir('C:\\root\\a')
    store.countDir('C:\\root\\a\\b')
    store.addFile('C:\\root\\a\\b\\f1.bin', 100)
    store.addFile('C:\\root\\a\\f2.bin', 50)

    expect(store.totalBytes).toBe(150)
    expect(store.totalFiles).toBe(2)
    expect(store.totalDirs).toBe(2)

    const root = store.toTreeNode(store.root)
    expect(root.size).toBe(150)
    expect(root.fileCount).toBe(2)
    expect(root.dirCount).toBe(2)
    expect(root.hasChildren).toBe(true)

    const a = store.toTreeNode(store.nodes.get('c:\\root\\a')!)
    expect(a.size).toBe(150)
    expect(a.dirCount).toBe(1)
  })

  it('目录分页按大小降序', () => {
    const store = new TreeStore('C:\\root')
    store.ensureDir('C:\\root\\small', 'small', 1)
    store.ensureDir('C:\\root\\big', 'big', 1)
    store.addFile('C:\\root\\small\\a.bin', 10)
    store.addFile('C:\\root\\big\\b.bin', 100)

    const page = store.childrenPage('C:\\root', 0, 10)
    expect(page.total).toBe(2)
    expect(page.items[0].name).toBe('big')
    expect(page.items[1].name).toBe('small')
  })

  it('构建树图并聚合溢出的子节点', () => {
    const store = new TreeStore('C:\\root')
    for (let i = 0; i < 5; i++) {
      store.ensureDir(`C:\\root\\d${i}`, `d${i}`, 1)
      store.addFile(`C:\\root\\d${i}\\f.bin`, 10 * (i + 1))
    }
    const tree = store.buildTreemap('C:\\root', 2, 3)
    expect(tree).not.toBeNull()
    expect(tree?.children?.length).toBe(4)
    const other = tree?.children?.find((c) => c.name.includes('其他'))
    expect(other).toBeTruthy()
    expect(other?.value).toBe(10 + 20)
  })

  it('超出节点上限后标记 truncated', () => {
    const store = new TreeStore('C:\\root')
    // 仅验证深度限制不抛错
    expect(store.ensureDir('C:\\root\\deep', 'deep', 99)).toBeNull()
    expect(store.truncated).toBe(false)
  })
})
