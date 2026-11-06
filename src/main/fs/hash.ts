import fs from 'node:fs'
import crypto from 'node:crypto'
import { AbortError } from '../core/errors'
import { toExtended } from '../core/paths'

const CHUNK = 16 * 1024

async function updateHashFromRange(
  filePath: string,
  start: number,
  length: number,
  hash: crypto.Hash
): Promise<void> {
  if (length <= 0) return
  const stream = fs.createReadStream(toExtended(filePath), {
    start,
    end: start + length - 1,
    highWaterMark: 1024 * 1024
  })
  for await (const chunk of stream) {
    hash.update(chunk as Buffer)
  }
}

/** 部分哈希：文件大小 + 前 16KB + 后 16KB */
export async function partialHash(filePath: string, size: number): Promise<string> {
  const hash = crypto.createHash('sha256')
  hash.update(String(size))
  if (size <= CHUNK * 2) {
    await updateHashFromRange(filePath, 0, size, hash)
  } else {
    await updateHashFromRange(filePath, 0, CHUNK, hash)
    await updateHashFromRange(filePath, size - CHUNK, CHUNK, hash)
  }
  return hash.digest('hex')
}

/** 完整哈希：流式读取，避免大文件占内存 */
export async function fullHash(filePath: string, signal?: AbortSignal): Promise<string> {
  const hash = crypto.createHash('sha256')
  const stream = fs.createReadStream(toExtended(filePath), {
    highWaterMark: 1024 * 1024
  })
  try {
    for await (const chunk of stream) {
      if (signal?.aborted) {
        stream.destroy()
        throw new AbortError()
      }
      hash.update(chunk as Buffer)
    }
  } finally {
    stream.destroy()
  }
  return hash.digest('hex')
}
