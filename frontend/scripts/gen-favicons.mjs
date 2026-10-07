// Generates all favicon sizes from public/favicon.svg (the header "W" logo).
// Run: npm run icons   (also runs automatically in the Docker build before `vite build`).
import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const dir = new URL('../public/', import.meta.url)
const svg = await readFile(new URL('favicon.svg', dir))

const png = (size) => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer()

const files = {
  'favicon-16x16.png': 16,
  'favicon-32x32.png': 32,
  'apple-touch-icon.png': 180,
  'android-chrome-192x192.png': 192,
  'android-chrome-512x512.png': 512,
}

for (const [name, size] of Object.entries(files)) {
  await writeFile(new URL(name, dir), await png(size))
}

// favicon.ico with 16/32/48 PNG images (PNG-in-ICO, supported by all current browsers).
const sizes = [16, 32, 48]
const images = await Promise.all(sizes.map(png))
const header = Buffer.alloc(6 + 16 * sizes.length)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(sizes.length, 4)

let offset = header.length
sizes.forEach((size, i) => {
  const e = 6 + 16 * i
  header.writeUInt8(size, e) // width
  header.writeUInt8(size, e + 1) // height
  header.writeUInt8(0, e + 2) // palette
  header.writeUInt8(0, e + 3) // reserved
  header.writeUInt16LE(1, e + 4) // color planes
  header.writeUInt16LE(32, e + 6) // bits per pixel
  header.writeUInt32LE(images[i].length, e + 8)
  header.writeUInt32LE(offset, e + 12)
  offset += images[i].length
})

await writeFile(new URL('favicon.ico', dir), Buffer.concat([header, ...images]))
console.log('favicons generated:', [...Object.keys(files), 'favicon.ico'].join(', '))
