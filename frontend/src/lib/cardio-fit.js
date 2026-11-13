// A reader for Garmin FIT activity files (Garmin Connect "Export Original", Strava's original
// uploads), hand-written like the writer in fit-export.js: a FIT file is a header, then records
// that are either a definition (which fields a local message type carries) or a data message laid
// out as its definition said, then a CRC. Only what an activity needs is read: record (the
// trackpoints), lap and session.
//
// Not read: developer fields (skipped by their size), strings, array fields beyond their first
// value, the CRC (a damaged file just yields what could be read), chained FIT files.
import { CardioError } from './cardio-error.js'

const FIT_EPOCH = 631065600
const SEMI = 180 / 2147483648

// Base types: [size, reader, invalid marker]. 'enum', 'uint8z' and the rest map onto these.
const BASE = {
  0: [1, (v, o) => v.getUint8(o), 0xFF], 1: [1, (v, o) => v.getInt8(o), 0x7F], 2: [1, (v, o) => v.getUint8(o), 0xFF],
  3: [2, (v, o, le) => v.getInt16(o, le), 0x7FFF], 4: [2, (v, o, le) => v.getUint16(o, le), 0xFFFF],
  5: [4, (v, o, le) => v.getInt32(o, le), 0x7FFFFFFF], 6: [4, (v, o, le) => v.getUint32(o, le), 0xFFFFFFFF],
  8: [4, (v, o, le) => v.getFloat32(o, le), null], 9: [8, (v, o, le) => v.getFloat64(o, le), null],
  10: [1, (v, o) => v.getUint8(o), 0], 11: [2, (v, o, le) => v.getUint16(o, le), 0], 12: [4, (v, o, le) => v.getUint32(o, le), 0],
  13: [1, (v, o) => v.getUint8(o), 0xFF],
}

const SPORTS = { 1: 'run', 2: 'bike', 11: null, 17: null }

/** FIT bytes → the activity shape of cardio-parse.js. */
export function parseFit(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const headerSize = b[0]
  if (b.length < 14 || (headerSize !== 12 && headerSize !== 14)) throw new CardioError('format', 'Not a FIT file.')
  const end = Math.min(b.length - 2, headerSize + view.getUint32(4, true))
  const defs = new Array(16)
  const records = [], laps = []
  let session = null, lastTs = 0, pos = headerSize

  const readField = (le, at, f) => {
    const type = BASE[f.type & 0x1F]
    if (!type || f.size < type[0]) return null
    const v = type[1](view, at, le)
    return v === type[2] || (typeof v === 'number' && Number.isNaN(v)) ? null : v
  }

  while (pos < end) {
    const hdr = b[pos++]
    let def, ts = null
    if ((hdr & 0x80) !== 0) {                       // compressed-timestamp header: a data message
      def = defs[(hdr >> 5) & 3]
      let t = (lastTs & ~0x1F) + (hdr & 0x1F)
      if (t < lastTs) t += 0x20
      ts = lastTs = t
    } else if ((hdr & 0x40) !== 0) {                // definition message
      const hasDev = (hdr & 0x20) !== 0
      if (pos + 5 > end) break
      pos++                                         // reserved
      const le = b[pos++] === 0
      const global = view.getUint16(pos, le); pos += 2
      const n = b[pos++]
      const fields = []
      for (let i = 0; i < n; i++) { fields.push({ num: b[pos], size: b[pos + 1], type: b[pos + 2] }); pos += 3 }
      let devSize = 0
      if (hasDev) { const nd = b[pos++]; for (let i = 0; i < nd; i++) { devSize += b[pos + 1]; pos += 3 } }
      defs[hdr & 0xF] = { le, global, fields, devSize, size: fields.reduce((s, f) => s + f.size, 0) + devSize }
      continue
    } else def = defs[hdr & 0xF]
    if (!def) throw new CardioError('format', 'A FIT data message came before its definition.')
    if (pos + def.size > b.length) break
    const m = {}
    let at = pos
    for (const f of def.fields) {
      const v = readField(def.le, at, f)
      if (v != null) m[f.num] = v
      at += f.size
    }
    pos += def.size
    if (m[253] != null) lastTs = m[253]
    if (ts != null && m[253] == null) m[253] = ts

    if (def.global === 20) {                        // record
      const t = m[253]
      if (t == null) continue
      const alt = m[78] != null ? m[78] / 5 - 500 : (m[2] != null ? m[2] / 5 - 500 : null)
      records.push({
        t: (t + FIT_EPOCH) * 1000,
        lat: m[0] != null ? m[0] * SEMI : null, lon: m[1] != null ? m[1] * SEMI : null,
        ele: alt, hr: m[3] ?? null, cad: m[4] ?? null, d: m[5] != null ? m[5] / 100 : null,
      })
    } else if (def.global === 19) {                 // lap
      laps.push({
        start: m[2] != null ? (m[2] + FIT_EPOCH) * 1000 : null,
        sec: m[8] != null ? m[8] / 1000 : (m[7] != null ? m[7] / 1000 : null),
        distM: m[9] != null ? m[9] / 100 : 0, hr: m[15] ?? null, maxHr: m[16] ?? null,
      })
    } else if (def.global === 18 && !session) {     // session (the first is enough: one activity per file)
      session = { sport: m[5], start: m[2] != null ? (m[2] + FIT_EPOCH) * 1000 : null }
    }
  }
  if (!records.length) throw new CardioError('empty', 'No track points in this FIT file.')
  // A point with a latitude but no longitude (or the reverse) is a half-fix: drop the position.
  for (const p of records) if (p.lat == null || p.lon == null) { p.lat = null; p.lon = null }
  return {
    sport: session && SPORTS[session.sport] !== undefined ? SPORTS[session.sport] : null,
    name: null, start: session?.start ?? records[0].t, points: records,
    laps: laps.filter(l => l.start != null && l.sec != null), source: 'fit',
  }
}
