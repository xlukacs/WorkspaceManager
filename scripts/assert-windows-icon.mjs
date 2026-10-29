import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { deflateSync } from 'node:zlib'

const iconPath = resolve(process.cwd(), 'build/icon.ico')
const iconDirectory = resolve(process.cwd(), 'build')
const ICON_SIZE = 256

function readUInt32(buffer, offset) {
  return buffer.readUInt32BE(offset)
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const value of buffer) {
    crc ^= value
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1)
      crc = (crc >>> 1) ^ (0xedb88320 & mask)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const lengthBuffer = Buffer.alloc(4)
  lengthBuffer.writeUInt32BE(data.length, 0)
  const crcBuffer = Buffer.alloc(4)
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer])
}

function createFallbackPng(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size)

  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * (size * 4 + 1)
    raw[rowOffset] = 0
    for (let x = 0; x < size; x += 1) {
      const pixelOffset = rowOffset + 1 + x * 4
      const centerX = size / 2
      const centerY = size / 2
      const dx = x - centerX
      const dy = y - centerY
      const distance = Math.sqrt(dx * dx + dy * dy)

      let red = 11
      let green = 18
      let blue = 28
      let alpha = 255

      if (distance < size * 0.34) {
        red = 255
        green = 191
        blue = 87
      } else if (distance < size * 0.45) {
        red = 32
        green = 43
        blue = 61
      }

      raw[pixelOffset] = red
      raw[pixelOffset + 1] = green
      raw[pixelOffset + 2] = blue
      raw[pixelOffset + 3] = alpha
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function createFallbackIco() {
  const png = createFallbackPng(ICON_SIZE)
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)

  const entry = Buffer.alloc(16)
  entry[0] = 0
  entry[1] = 0
  entry[2] = 0
  entry[3] = 0
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(22, 12)

  return Buffer.concat([header, entry, png])
}

function hasLargeEnoughIcon(buffer) {
  if (buffer.length < 6) return false
  const type = buffer.readUInt16LE(2)
  const count = buffer.readUInt16LE(4)
  if (type !== 1 || count < 1) return false

  for (let index = 0; index < count; index += 1) {
    const entryOffset = 6 + index * 16
    if (buffer.length < entryOffset + 16) return false
    const width = buffer[entryOffset] === 0 ? 256 : buffer[entryOffset]
    const height = buffer[entryOffset + 1] === 0 ? 256 : buffer[entryOffset + 1]
    const size = buffer.readUInt32LE(entryOffset + 8)
    const offset = buffer.readUInt32LE(entryOffset + 12)
    if (buffer.length < offset + size) return false

    if (width >= ICON_SIZE && height >= ICON_SIZE) {
      const payload = buffer.subarray(offset, offset + size)
      const isPng = payload.length > 24
        && payload[0] === 137
        && payload[1] === 80
        && payload[2] === 78
        && payload[3] === 71

      if (!isPng) return true
      const pngWidth = readUInt32(payload, 16)
      const pngHeight = readUInt32(payload, 20)
      if (pngWidth >= ICON_SIZE && pngHeight >= ICON_SIZE) return true
    }
  }

  return false
}

try {
  const existing = await readFile(iconPath).catch(() => null)
  if (existing && hasLargeEnoughIcon(existing)) {
    console.info(`Windows icon OK: ${iconPath}`)
  } else {
    await mkdir(iconDirectory, { recursive: true })
    await writeFile(iconPath, createFallbackIco())
    console.info(`Generated fallback Windows icon at ${iconPath}`)
  }
} catch (error) {
  console.error(`Unable to prepare Windows icon at ${iconPath}`)
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
