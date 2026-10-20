// Remove camera metadata from JPEGs we publish.
//
// Four photos served from public/landing/ carried full iPhone EXIF: make,
// model, timestamp, and on three of them GPS coordinates. They are on a
// public website, so anyone could download one and read where it was taken.
// A photo of somebody's dog on their own floor puts that somewhere near their
// home.
//
// Drops every APPn segment except APP0/JFIF (which keeps the file a valid
// JPEG) and every COM comment. Pixels are untouched: this re-writes the
// container, it does not re-encode the image, so there is no quality loss.
//
//   node scripts/strip-image-metadata.mjs public/landing/*.jpg
//   node scripts/strip-image-metadata.mjs --check public/landing/*.jpg

import fs from 'node:fs'

const KEEP_APP0 = 0xE0

export function stripJpegMetadata(buf) {
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) return { out: buf, dropped: [] }
  const out = [buf.subarray(0, 2)]
  const dropped = []
  let i = 2
  while (i < buf.length) {
    if (buf[i] !== 0xFF) { out.push(buf.subarray(i)); break }
    const marker = buf[i + 1]
    if (marker === 0xD8) { i += 2; continue }
    // Start of scan: everything after this is entropy-coded pixel data.
    if (marker === 0xDA) { out.push(buf.subarray(i)); break }
    const len = buf.readUInt16BE(i + 2)
    const isAppn = marker >= 0xE0 && marker <= 0xEF
    const isComment = marker === 0xFE
    if ((isAppn && marker !== KEEP_APP0) || isComment) {
      dropped.push('0x' + marker.toString(16))
      i += 2 + len
      continue
    }
    out.push(buf.subarray(i, i + 2 + len))
    i += 2 + len
  }
  return { out: Buffer.concat(out), dropped }
}

// Only run the CLI when invoked directly, so the test can import the function.
const invokedDirectly = process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href

if (!invokedDirectly) { /* imported: export only */ } else {

const args = process.argv.slice(2)
const check = args.includes('--check')
const files = args.filter(a => !a.startsWith('--'))
if (!files.length) {
  console.error('Usage: node scripts/strip-image-metadata.mjs [--check] <files…>')
  process.exit(1)
}

let changed = 0
for (const f of files) {
  const buf = fs.readFileSync(f)
  const { out, dropped } = stripJpegMetadata(buf)
  const had = dropped.length > 0
  if (had) changed++
  const saved = buf.length - out.length
  console.log(`${had ? (check ? 'HAS METADATA' : 'stripped    ') : 'clean       '}  ${f}` +
    (had ? `  segments ${dropped.join(',')}  -${saved} bytes` : ''))
  if (had && !check) fs.writeFileSync(f, out)
}
if (check && changed) {
  console.log(`\n${changed} file(s) still carry metadata.`)
  process.exit(1)
}

}
