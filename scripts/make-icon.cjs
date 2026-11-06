const { app, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

function buildIco(png) {
  const header = Buffer.alloc(22)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  header.writeUInt8(0, 6)
  header.writeUInt8(0, 7)
  header.writeUInt8(0, 8)
  header.writeUInt8(0, 9)
  header.writeUInt16LE(1, 10)
  header.writeUInt16LE(32, 12)
  header.writeUInt32LE(png.length, 14)
  header.writeUInt32LE(22, 18)
  return Buffer.concat([header, png])
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function roundedRectDistance(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - (halfW - radius)
  const qy = Math.abs(py - cy) - (halfH - radius)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  const inside = Math.min(Math.max(qx, qy), 0)
  return outside + inside - radius
}

/** 生成带抗锯齿圆角的 nativeImage（圆角外透明） */
function roundImage(image, size, radiusRatio = 0.22) {
  const resized = image.resize({ width: size, height: size, quality: 'best' })
  const bitmap = resized.toBitmap()
  const radius = size * radiusRatio
  const half = size / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = roundedRectDistance(x + 0.5, y + 0.5, half, half, half, half, radius)
      const coverage = clamp(0.5 - distance, 0, 1)
      const alphaIndex = (y * size + x) * 4 + 3
      bitmap[alphaIndex] = Math.round(bitmap[alphaIndex] * coverage)
    }
  }
  return nativeImage.createFromBitmap(bitmap, { width: size, height: size })
}

app
  .whenReady()
  .then(() => {
    const root = path.join(__dirname, '..')
    const source = path.join(root, 'vein.jpg')
    const outDir = path.join(root, 'resources')
    fs.mkdirSync(outDir, { recursive: true })

    const image = nativeImage.createFromPath(source)
    if (image.isEmpty()) throw new Error(`无法读取图片：${source}`)

    const { width, height } = image.getSize()
    const side = Math.min(width, height)
    const cropped = image.crop({
      x: Math.floor((width - side) / 2),
      y: Math.floor((height - side) / 2),
      width: side,
      height: side
    })

    const png256 = roundImage(cropped, 256).toPNG()
    const png512 = roundImage(cropped, 512).toPNG()
    const png1024 = roundImage(cropped, 1024).toPNG()

    fs.writeFileSync(path.join(outDir, 'icon.png'), png512)
    fs.writeFileSync(path.join(outDir, 'icon-256.png'), png256)
    fs.writeFileSync(path.join(outDir, 'icon-1024.png'), png1024)
    fs.writeFileSync(path.join(outDir, 'icon.ico'), buildIco(png256))
    fs.copyFileSync(source, path.join(outDir, 'icon-source.jpg'))

    console.log(`图标已生成：源图 ${width}x${height}，裁剪 ${side}x${side}`)
    app.quit()
  })
  .catch((err) => {
    console.error(err)
    app.exit(1)
  })
