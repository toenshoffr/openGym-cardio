// Reads the activity files out of a zip: a Garmin Connect "Export Original" (one .fit), or a Strava
// archive (hundreds of .fit.gz, .gpx and .tcx among a lot that is not an activity). Browser and Node 22:
// the central directory is read by hand and a deflated entry is inflated with DecompressionStream
// ('deflate-raw'), no library. lib/zip.js is the app's own store-only zip for backups and says no to
// deflate on purpose; this is a reader for what other services hand out.
//
// Refused: encryption, ZIP64, an entry that unpacks past ENTRY_MAX, an archive of more than
// MAX_ENTRIES activity files. What is not an activity file (by name) is skipped without being read.
import { CardioError } from './cardio-error.js'

export const MAX_ENTRIES = 2000
export const ENTRY_MAX = 100 * 1024 * 1024
export const ACTIVITY = /\.(fit|gpx|tcx)(\.gz)?$/i
const u16 = (b, o) => b[o] | (b[o + 1] << 8)
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0

export const looksLikeZip = b => b.length > 3 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5) && (b[3] === 4 || b[3] === 6)

/** The activity files of a zip, as { name, read() } where read() gives the bytes (inflated on demand). */
export function listZip(bytes, pick = ACTIVITY) {
  if (!looksLikeZip(bytes) || bytes.length < 22) throw new CardioError('format', 'Not a zip file.')
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (u32(bytes, i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new CardioError('format', 'Not a readable zip file.')
  const count = u16(bytes, eocd + 10)
  let p = u32(bytes, eocd + 16)
  if (count === 0xffff || p === 0xffffffff) throw new CardioError('format', 'ZIP64 archives are not supported.')
  const out = []
  const dec = new TextDecoder()
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) throw new CardioError('format', 'Damaged zip file.')
    const flags = u16(bytes, p + 8), method = u16(bytes, p + 10)
    const csize = u32(bytes, p + 20), usize = u32(bytes, p + 24)
    const nlen = u16(bytes, p + 28), xlen = u16(bytes, p + 30), clen = u16(bytes, p + 32)
    const local = u32(bytes, p + 42)
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen))
    p += 46 + nlen + xlen + clen
    if (name.endsWith('/') || !pick.test(name) || /(^|\/)__MACOSX\/|(^|\/)\._/.test(name)) continue
    if (out.length >= MAX_ENTRIES) throw new CardioError('format', `More than ${MAX_ENTRIES} activity files in one zip.`)
    out.push({ name, read: () => readEntry(bytes, { flags, method, csize, usize, local }) })
  }
  return out
}

async function readEntry(bytes, e) {
  if (e.flags & 1) throw new CardioError('format', 'An encrypted zip.')
  if (e.method !== 0 && e.method !== 8) throw new CardioError('format', 'An unsupported zip compression.')
  if (e.usize > ENTRY_MAX || e.csize === 0xffffffff || e.usize === 0xffffffff) throw new CardioError('format', 'A file in the zip is too big.')
  if (e.local + 30 > bytes.length || u32(bytes, e.local) !== 0x04034b50) throw new CardioError('format', 'Damaged zip file.')
  const start = e.local + 30 + u16(bytes, e.local + 26) + u16(bytes, e.local + 28)
  if (start + e.csize > bytes.length) throw new CardioError('format', 'Damaged zip file.')
  const raw = bytes.subarray(start, start + e.csize)
  if (e.method === 0) return new Uint8Array(raw)
  if (typeof DecompressionStream === 'undefined') throw new CardioError('gz', 'This browser cannot unpack zip files.')
  // Counted as it comes: what a zip says it unpacks to is not to be trusted.
  const reader = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  const parts = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > ENTRY_MAX) { reader.cancel().catch(() => {}); throw new CardioError('format', 'A file in the zip is too big.') }
    parts.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const v of parts) { out.set(v, at); at += v.length }
  return out
}
