import fs from 'node:fs'
import path from 'node:path'

/** 简易 JSON 原子存储：写临时文件后 rename */
export class JsonStore<T extends object> {
  constructor(
    private readonly file: string,
    private readonly defaults: T
  ) {}

  read(): T {
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      const parsed = JSON.parse(raw) as Partial<T>
      return { ...this.defaults, ...parsed } as T
    } catch {
      return { ...this.defaults } as T
    }
  }

  write(value: T): void {
    const dir = path.dirname(this.file)
    fs.mkdirSync(dir, { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    fs.renameSync(tmp, this.file)
  }

  patch(partial: Partial<T>): T {
    const next = { ...this.read(), ...partial }
    this.write(next)
    return next
  }
}
