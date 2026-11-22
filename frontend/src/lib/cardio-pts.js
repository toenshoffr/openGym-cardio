// How the route and the pace/climb profile of a session are kept (lib/cardio-analyze.js profileOf):
// as one short string, not an array of arrays. A session used to keep ~150 rows of six numbers as JSON,
// 5 KB of its 7 KB, and the whole profile is one document the server takes up to 5 MB of (and every
// sync sends it whole). Delta-coded the same rows take about a third, so a profile holds three times
// the sessions.
//
// A row is [lat×1e5, lon×1e5, elevation m, distance m, speed m/s ×100, heart rate]; lat, lon, elevation
// and heart rate may be null. The string is `p1:<rows>:` and then one cell per number: the change
// since the row before (distance: the change of that change, as the spacing is nearly even), zigzagged
// to a non-negative integer, +1 so that 0 can mean null, and written as a base-64 varint (5 bits a
// character, the 6th says "more follows"; the alphabet is URL-safe, so it needs no escaping in JSON).
//
// Sessions saved before this keep their array: ptsOf reads both, so nothing is migrated.
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const INDEX = Object.fromEntries([...ALPHA].map((c, i) => [c, i]))
const COLS = 6
const zig = d => (d >= 0 ? d * 2 : -d * 2 - 1)
const unzig = z => (z % 2 === 0 ? z / 2 : -(z + 1) / 2)

function put(out, n) {
  while (n >= 32) { out.push(ALPHA[32 | (n % 32)]); n = Math.floor(n / 32) }
  out.push(ALPHA[n])
}

/** Rows → the compact string. Anything that is not a number counts as missing. */
export function packPts(rows) {
  const out = []
  const prev = new Array(COLS).fill(0)
  let prevStep = 0
  for (const row of rows) {
    for (let c = 0; c < COLS; c++) {
      const v = Number.isFinite(row[c]) ? Math.round(row[c]) : null
      if (v == null) { put(out, 0); continue }
      if (c === 3) {                           // distance: delta of delta
        const step = v - prev[3]
        put(out, zig(step - prevStep) + 1)
        prevStep = step
      } else put(out, zig(v - prev[c]) + 1)
      prev[c] = v
    }
  }
  return 'p1:' + rows.length + ':' + out.join('')
}

/** The compact string → rows. Anything that does not read is an empty profile, never an exception. */
export function unpackPts(str) {
  const m = /^p1:(\d+):([A-Za-z0-9_-]*)$/.exec(String(str))
  if (!m) return []
  const n = Number(m[1]), s = m[2]
  const prev = new Array(COLS).fill(0)
  let prevStep = 0, at = 0
  const rows = []
  const take = () => {
    let v = 0, mul = 1
    for (;;) {
      if (at >= s.length) return NaN
      const d = INDEX[s[at++]]
      v += (d & 31) * mul
      if (d < 32) return v
      mul *= 32
    }
  }
  for (let r = 0; r < n; r++) {
    const row = new Array(COLS)
    for (let c = 0; c < COLS; c++) {
      const z = take()
      if (Number.isNaN(z)) return []
      if (z === 0) { row[c] = null; continue }
      const d = unzig(z - 1)
      if (c === 3) { prevStep += d; prev[3] += prevStep; row[c] = prev[3] } else { prev[c] += d; row[c] = prev[c] }
    }
    rows.push(row)
  }
  return rows
}

const cache = new Map()
/** The rows of a session, whether it kept the old array or the packed string. Decoded once per string. */
export function ptsOf(x) {
  const p = x?.pts
  if (Array.isArray(p)) return p
  if (typeof p !== 'string') return []
  let rows = cache.get(p)
  if (!rows) { rows = unpackPts(p); if (cache.size > 64) cache.clear(); cache.set(p, rows) }
  return rows
}
