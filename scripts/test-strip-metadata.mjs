// The metadata stripper must remove what it claims and nothing else.
import fs from 'node:fs'
import { stripJpegMetadata } from './strip-image-metadata.mjs'

let pass = 0, fail = 0
const eq = (l, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fail++; console.log(`  FAIL ${l}\n       got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
}

// A JPEG built by hand: SOI, APP0/JFIF, APP1/EXIF, a comment, SOF0, SOS+data.
const seg = (marker, body) => Buffer.concat([
  Buffer.from([0xFF, marker]),
  (() => { const b = Buffer.alloc(2); b.writeUInt16BE(body.length + 2); return b })(),
  body,
])
const SOI  = Buffer.from([0xFF, 0xD8])
const APP0 = seg(0xE0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0'))
const APP1 = seg(0xE1, Buffer.concat([Buffer.from('Exif\0\0'), Buffer.from('GPS-ish payload')]))
const COM  = seg(0xFE, Buffer.from('a comment'))
const SOF0 = seg(0xC0, Buffer.from([0x08, 0x00, 0x80, 0x00, 0x80, 0x01, 0x01, 0x11, 0x00]))
const SOS  = Buffer.concat([seg(0xDA, Buffer.from([0x01, 0x01, 0x00, 0x00, 0x3F, 0x00])),
                            Buffer.from([0x12, 0x34, 0x56, 0xFF, 0xD9])])
const jpeg = Buffer.concat([SOI, APP0, APP1, COM, SOF0, SOS])

const { out, dropped } = stripJpegMetadata(jpeg)
eq('drops APP1 and the comment', dropped.sort(), ['0xe1', '0xfe'])
eq('keeps APP0 so the file stays a valid JPEG', out.includes(Buffer.from('JFIF')), true)
eq('the EXIF payload is gone', out.includes(Buffer.from('Exif')), false)
eq('the comment is gone', out.includes(Buffer.from('a comment')), false)
eq('SOF0 survives, so the image still has dimensions', out.includes(SOF0), true)
eq('the scan data is byte-identical', out.subarray(out.length - 5).toString('hex'), '1234 56ff d9'.replace(/ /g, ''))
eq('it got smaller', out.length < jpeg.length, true)

// Running it twice must change nothing the second time.
const again = stripJpegMetadata(out)
eq('idempotent: nothing left to drop', again.dropped, [])
eq('idempotent: bytes unchanged', again.out.equals(out), true)

// A file with no metadata must come back untouched.
const plain = Buffer.concat([SOI, APP0, SOF0, SOS])
const p = stripJpegMetadata(plain)
eq('a clean JPEG is returned as is', p.out.equals(plain), true)
eq('and reports nothing dropped', p.dropped, [])

// Not a JPEG: leave it alone rather than corrupt it.
const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3])
const n = stripJpegMetadata(png)
eq('a PNG is passed through untouched', n.out.equals(png), true)
eq('and reports nothing dropped', n.dropped, [])

// The real files must stay clean.
for (const f of fs.readdirSync('public/landing').filter(n => n.endsWith('.jpg'))) {
  const buf = fs.readFileSync('public/landing/' + f)
  eq(`public/landing/${f} carries no metadata`, stripJpegMetadata(buf).dropped, [])
  eq(`public/landing/${f} contains no camera make`, buf.includes(Buffer.from('Apple')), false)
}

console.log(`\nstrip metadata: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
