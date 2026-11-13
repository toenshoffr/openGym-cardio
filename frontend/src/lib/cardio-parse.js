// Reads an activity file from Strava, Garmin Connect or any watch into one plain shape
// (v1.5, Cardio): GPX and TCX here, FIT in cardio-fit.js. Pure and DOM-free (no DOMParser), so
// it behaves the same in the browser, on the phone and under test.
//
//   { sport: 'run' | 'bike' | null, name, start (ms), points: [{ t, lat, lon, ele, hr, cad, d }],
//     laps: [{ start, sec, distM, hr, maxHr }], source: 'gpx' | 'tcx' | 'fit' }
//
// `t` is a time in ms, `d` the distance in metres the file itself counted (TCX and FIT carry
// one; GPX does not, then the analysis measures it from the coordinates). Anything a file does
// not have is null. A file with nothing usable throws a CardioError with a `code` the screen words.
import { parseFit } from './cardio-fit.js'
import { CardioError } from './cardio-error.js'
export { CardioError }

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null }
const unxml = s => String(s ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
const attr = (s, name) => { const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`).exec(s); return m ? m[1] : null }
// The text of the first <tag>…</tag>, whatever its namespace prefix (gpxtpx:hr, ns3:RunCadence).
const text = (s, tag) => {
  const m = new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`).exec(s)
  return m ? unxml(m[1]) : null
}
const ms = v => { if (!v) return null; const t = Date.parse(v); return Number.isFinite(t) ? t : null }

/** 'running' / 'Biking' / 'VirtualRide' / 'trail_running' / FIT sport names → 'run' | 'bike' | null. */
export function sportOf(raw) {
  const s = String(raw ?? '').toLowerCase()
  if (!s) return null
  if (/run|jog|treadmill|walk|hik/.test(s)) return /walk|hik/.test(s) ? null : 'run'
  if (/bik|cycl|ride|mtb|gravel|ebike/.test(s)) return 'bike'
  // Strava's numeric GPX types.
  if (s === '9') return 'run'
  if (s === '1') return 'bike'
  return null
}

/** Whether `s` is GPX, TCX, or neither. */
export function xmlKind(s) {
  const head = String(s).slice(0, 4000)
  if (/<gpx[\s>]/i.test(head)) return 'gpx'
  if (/<TrainingCenterDatabase[\s>]/i.test(head)) return 'tcx'
  return null
}

export function parseGpx(xml) {
  const body = String(xml)
  const trk = /<trk\b[\s\S]*?<\/trk>/.exec(body)?.[0] || body
  const points = []
  const re = /<trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/trkpt>)/g
  for (const m of trk.matchAll(re)) {
    const lat = num(attr(m[1], 'lat')), lon = num(attr(m[1], 'lon'))
    const inner = m[2] || ''
    const t = ms(text(inner, 'time'))
    if (t == null || (lat == null && lon == null)) continue
    points.push({
      t, lat, lon, ele: num(text(inner, 'ele')),
      hr: num(text(inner, 'hr')), cad: num(text(inner, 'cad')), d: null,
    })
  }
  if (!points.length) throw new CardioError('empty', 'No track points with a time in this GPX file.')
  const name = text(trk.replace(/<trkseg[\s\S]*$/, ''), 'name') || text(body.replace(/<trk\b[\s\S]*$/, ''), 'name')
  const type = text(trk.replace(/<trkseg[\s\S]*$/, ''), 'type')
  return { sport: sportOf(type), name: name || null, start: points[0].t, points, laps: [], source: 'gpx' }
}

export function parseTcx(xml) {
  const body = String(xml)
  const act = /<Activity\b([^>]*)>/.exec(body)
  const sport = sportOf(act ? attr(act[1], 'Sport') : null)
  const points = [], laps = []
  for (const lm of body.matchAll(/<Lap\b([^>]*)>([\s\S]*?)<\/Lap>/g)) {
    const head = lm[2].replace(/<Track\b[\s\S]*$/, '')
    const lapStart = ms(attr(lm[1], 'StartTime'))
    const sec = num(text(head, 'TotalTimeSeconds')), distM = num(text(head, 'DistanceMeters'))
    const avg = /<AverageHeartRateBpm\b[^>]*>([\s\S]*?)<\/AverageHeartRateBpm>/.exec(head)
    const max = /<MaximumHeartRateBpm\b[^>]*>([\s\S]*?)<\/MaximumHeartRateBpm>/.exec(head)
    if (lapStart != null && sec != null) {
      laps.push({ start: lapStart, sec, distM: distM ?? 0, hr: avg ? num(text(avg[1], 'Value')) : null, maxHr: max ? num(text(max[1], 'Value')) : null })
    }
    for (const pm of lm[2].matchAll(/<Trackpoint\b[^>]*>([\s\S]*?)<\/Trackpoint>/g)) {
      const p = pm[1]
      const t = ms(text(p, 'Time'))
      if (t == null) continue
      const pos = /<Position\b[^>]*>([\s\S]*?)<\/Position>/.exec(p)
      const hrBlock = /<HeartRateBpm\b[^>]*>([\s\S]*?)<\/HeartRateBpm>/.exec(p)
      points.push({
        t,
        lat: pos ? num(text(pos[1], 'LatitudeDegrees')) : null,
        lon: pos ? num(text(pos[1], 'LongitudeDegrees')) : null,
        ele: num(text(p, 'AltitudeMeters')),
        hr: hrBlock ? num(text(hrBlock[1], 'Value')) : null,
        cad: num(text(p, 'RunCadence')) ?? num(text(p, 'Cadence')),
        d: num(text(p.replace(/<Extensions\b[\s\S]*?<\/Extensions>/g, ''), 'DistanceMeters')),
      })
    }
  }
  if (!points.length) throw new CardioError('empty', 'No track points in this TCX file.')
  const id = act ? text(body, 'Id') : null
  return { sport, name: null, start: ms(id) ?? points[0].t, points, laps, source: 'tcx' }
}

const GZIP = b => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b

/** Gunzips bytes (Strava's `.fit.gz` and `.gpx.gz` exports) with the platform's DecompressionStream. */
export async function gunzip(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new CardioError('gz', 'This browser cannot unpack .gz files.')
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * Bytes of a .gpx, .tcx or .fit file (each optionally gzipped) → the parsed activity.
 * The format is read from the content, never the file name.
 */
export async function parseActivity(input) {
  let bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (GZIP(bytes)) bytes = await gunzip(bytes)
  if (bytes.length >= 12 && String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === '.FIT') return parseFit(bytes)
  if (bytes.length > 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    throw new CardioError('zip', 'This is a zip file. Unpack it and pick the .fit, .gpx or .tcx inside.')
  }
  const xml = new TextDecoder('utf-8').decode(bytes)
  const kind = xmlKind(xml)
  if (kind === 'gpx') return parseGpx(xml)
  if (kind === 'tcx') return parseTcx(xml)
  throw new CardioError('format', 'Not a GPX, TCX or FIT file.')
}
