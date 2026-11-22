// From a parsed activity (cardio-parse.js) to what openGym keeps of a run or ride: totals,
// a split for every kilometre, the watch's own laps, the best efforts over 1, 5, 10 km and so on,
// the climb, and a small downsampled track for the route map and the pace/elevation profile.
//
// Pure. Kilometre splits are the unit on purpose (the same for runs and rides); a ride's screen
// shows them as km/h instead of min/km (lib/cardio.js).
//
// What is stored is deliberately small: the whole profile document syncs as one JSON (the API
// takes 5 MB), so a session keeps ~150 profile points, not the thousands a watch records, and keeps
// them as the compact string of cardio-pts.js (about 1.5 KB, a third of the array it used to be).
import { CardioError } from './cardio-error.js'
import { packPts } from './cardio-pts.js'

const R = 6371008.8
const rad = x => x * Math.PI / 180
export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

// Below this a stretch counts as standing still (a traffic light, a drink). 0.5 m/s = 3 km/h.
export const STOP_SPEED = 0.5
// Faster than this between two fixes is a glitch, not a runner or a rider (m/s: 43 km/h, 108 km/h).
export const MAX_SPEED = { run: 12, bike: 30 }
// What counts as a heart rate at all.
export const HR_MIN = 30, HR_MAX = 250
// A gap between two points longer than this with hardly any movement is an auto-pause.
const PAUSE_GAP_S = 8
export const BEST_TARGETS = [1000, 5000, 10000, 21097.5, 42195]
export const PROFILE_POINTS = 150
export const MIN_SPLIT_M = 100          // a last partial kilometre shorter than this is dropped

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length
const round = (x, d = 0) => { const k = 10 ** d; return Math.round(x * k) / k }
const lastOf = a => a[a.length - 1]

/** Linear interpolation of `ys` at `x` over ascending `xs` (clamped to both ends). */
function interp(xs, ys, x, from = 0) {
  let lo = from, hi = xs.length - 1
  if (x <= xs[0]) return ys[0]
  if (x >= xs[hi]) return ys[hi]
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid }
  const span = xs[hi] - xs[lo]
  return span <= 0 ? ys[lo] : ys[lo] + (ys[hi] - ys[lo]) * (x - xs[lo]) / span
}

/** Elevation with the GPS jitter taken out: a moving average over `w` points. */
function smooth(values, w) {
  const out = new Array(values.length).fill(null)
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) continue
    let s = 0, n = 0
    for (let j = Math.max(0, i - w); j <= Math.min(values.length - 1, i + w); j++) if (values[j] != null) { s += values[j]; n++ }
    out[i] = s / n
  }
  return out
}

/** Gain and loss in metres, counting a change only once it exceeds `thr` (hysteresis, like a watch). */
export function climb(ele, thr = 3) {
  let gain = 0, loss = 0, ref = null
  for (const e of ele) {
    if (e == null) continue
    if (ref == null) { ref = e; continue }
    if (e - ref >= thr) { gain += e - ref; ref = e }
    else if (ref - e >= thr) { loss += ref - e; ref = e }
  }
  return { gain: round(gain), loss: round(loss) }
}

/** The fastest stretch of `target` metres: { sec, startM } or null if the activity is shorter. */
export function bestEffort(dist, mt, target) {
  const total = lastOf(dist)
  if (!(total >= target)) return null
  let best = null
  for (let i = 0; i < dist.length; i++) {
    if (dist[i] + target > total) break
    const endT = interp(dist, mt, dist[i] + target, i)
    const sec = endT - mt[i]
    if (sec > 0 && (best == null || sec < best.sec)) best = { sec, startM: dist[i] }
  }
  return best && { sec: round(best.sec, 1), startM: round(best.startM) }
}

/**
 * Parsed activity → the session fields that come from the file. Throws CardioError
 * 'nodistance' when the file has neither a distance nor positions to measure one.
 */
export function analyze(parsed) {
  const pts = [...parsed.points].filter(p => Number.isFinite(p.t)).sort((a, b) => a.t - b.t)
    .filter((p, i, a) => i === 0 || p.t !== a[i - 1].t)
  if (pts.length < 2) throw new CardioError('empty', 'Too few track points.')

  // Two kinds of bad reading, dealt with before anything is measured:
  //  - a GPS glitch, one fix a few hundred metres off, which would add that distance twice and make an
  //    impossible best kilometre. A fix whose speed from the last good one is beyond what a person or a
  //    bike does is left out of the track; one that stays "too far" is believed once enough time has
  //    passed to have covered it, so a real jump after a tunnel is not thrown away for good.
  //  - a heart rate of 0 (a strap that lost contact) or a spike over 250, which is no heart rate.
  // Copies, never the parsed file's own points.
  const cap = MAX_SPEED[parsed.sport] ?? MAX_SPEED.bike
  let good = null
  const cut = []                                   // [index, the point as it was] for every fix left out
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    if (p.hr != null && !(p.hr > HR_MIN && p.hr < HR_MAX)) pts[i] = { ...p, hr: null }
    if (p.lat == null) continue
    if (good) {
      const dt = (p.t - good.t) / 1000
      if (dt > 0 && haversine(good.lat, good.lon, p.lat, p.lon) / dt > cap) { cut.push([i, pts[i]]); pts[i] = { ...pts[i], lat: null, lon: null }; continue }
    }
    good = p
  }
  // Glitches are few. When a quarter of the fixes are "impossible" the limit is what is wrong (a ride
  // saved as a run, say), so the track is taken as it is rather than thrown away.
  const fixes = pts.filter(p => p.lat != null).length + cut.length
  if (cut.length > 0.25 * fixes) for (const [i, p] of cut) pts[i] = p

  // Cumulative distance: the file's own where it has one (a watch knows its own sensors, and a
  // treadmill run has no GPS at all), measured from the coordinates otherwise.
  const hasD = pts.filter(p => p.d != null).length > pts.length * 0.5
  const hasPos = pts.filter(p => p.lat != null).length > pts.length * 0.5
  if (!hasD && !hasPos) throw new CardioError('nodistance', 'No distance and no positions in this file.')
  const dist = [0]
  let lastLat = null, lastLon = null, lastD = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    let d = dist[i - 1] ?? 0
    if (hasD) {
      if (p.d != null) d = Math.max(d, p.d)
    } else if (p.lat != null) {
      if (lastLat != null) d += haversine(lastLat, lastLon, p.lat, p.lon)
      lastLat = p.lat; lastLon = p.lon
    }
    dist[i] = d
    lastD = d
  }
  if (!(lastD > 50)) throw new CardioError('nodistance', 'Under 50 m in this file.')

  // Moving time: seconds in which the speed was above standing still. A long gap with almost no
  // movement is an auto-pause and counts for nothing; a long gap that covered ground (the GPS
  // dropped out in a tunnel) counts as moving.
  const mt = [0]
  for (let i = 1; i < pts.length; i++) {
    const dt = (pts[i].t - pts[i - 1].t) / 1000, dd = dist[i] - dist[i - 1]
    const v = dt > 0 ? dd / dt : 0
    const moving = v >= STOP_SPEED && !(dt > PAUSE_GAP_S && dd < STOP_SPEED * dt)
    mt[i] = mt[i - 1] + (moving ? dt : 0)
  }
  const movingSec = mt[mt.length - 1]
  const elapsedSec = (lastOf(pts).t - pts[0].t) / 1000
  if (!(movingSec > 10)) throw new CardioError('nodistance', 'No movement in this file.')

  const eleRaw = pts.map(p => p.ele)
  const ele = smooth(eleRaw, 2)
  const { gain, loss } = climb(ele)
  const hrs = pts.map(p => p.hr), hasHr = hrs.some(h => h != null)

  // Splits: the moving time at every full kilometre, interpolated between points.
  const splits = []
  const total = lastOf(dist)
  let prevM = 0, prevT = 0
  const edges = []
  for (let k = 1000; k <= total; k += 1000) edges.push(k)
  if (total - (edges.length ? lastOf(edges) : 0) >= MIN_SPLIT_M) edges.push(total)
  for (let n = 0; n < edges.length; n++) {
    const m = edges[n], t = interp(dist, mt, m)
    const sec = t - prevT, dM = m - prevM
    let hrSum = 0, hrN = 0
    for (let i = 0; i < pts.length; i++) if (dist[i] > prevM && dist[i] <= m && hrs[i] != null) { hrSum += hrs[i]; hrN++ }
    const e0 = ele[0] == null ? null : interp(dist, ele.map(e => e ?? 0), prevM)
    const e1 = ele[0] == null ? null : interp(dist, ele.map(e => e ?? 0), m)
    splits.push({
      km: n + 1, distM: round(dM), sec: round(sec, 1),
      pace: sec > 0 ? round(sec / dM * 1000, 1) : null,
      elev: e0 == null ? null : round(e1 - e0),
      hr: hrN ? round(hrSum / hrN) : null,
      full: dM >= 999.5,
    })
    prevM = m; prevT = t
  }

  const laps = (parsed.laps || []).filter(l => l.sec > 0 && l.distM > 0).map((l, i) => ({
    n: i + 1, distM: round(l.distM), sec: round(l.sec, 1),
    pace: round(l.sec / l.distM * 1000, 1), hr: l.hr != null ? round(l.hr) : null, maxHr: l.maxHr != null ? round(l.maxHr) : null,
  }))

  const best = {}
  for (const target of BEST_TARGETS) {
    const b = bestEffort(dist, mt, target)
    if (b) best[Math.round(target)] = b
  }

  // Heart rate and cadence. Running cadence is stored per leg by most watches (80-95 for a
  // runner at 160-190 steps a minute); it is shown as steps a minute, so double a per-leg one.
  const hrVals = hrs.filter(h => h != null)
  let avgCad = null
  const cads = pts.map(p => p.cad).filter(c => c != null && c > 0)
  if (cads.length > pts.length * 0.3) {
    avgCad = mean(cads)
    if (parsed.sport === 'run' && avgCad < 120) avgCad *= 2
    avgCad = round(avgCad)
  }

  const start = parsed.start ?? pts[0].t
  return {
    sport: parsed.sport || null,
    name: parsed.name || null,
    start,
    distM: round(total),
    movingSec: round(movingSec),
    elapsedSec: round(elapsedSec),
    elevGain: gain, elevLoss: loss,
    avgHr: hrVals.length ? round(mean(hrVals)) : null,
    maxHr: hrVals.length ? Math.max(...hrVals) : null,
    avgCad,
    splits, laps, best,
    pts: packPts(profileOf(pts, dist, mt, ele, hasPos, hasHr)),
    source: parsed.source,
  }
}

/**
 * ~150 points for the route map and the pace/elevation chart, as compact rows:
 * [lat×1e5, lon×1e5, elevation m, distance m, speed m/s ×100, heart rate] with null where a
 * file has none. Speed is the average over the stretch to the next kept point, so it reads as
 * a smooth line rather than GPS noise.
 */
export function profileOf(pts, dist, mt, ele, hasPos, hasHr) {
  const n = pts.length
  const keep = Math.min(PROFILE_POINTS, n)
  const idx = []
  for (let k = 0; k < keep; k++) idx.push(Math.round(k * (n - 1) / Math.max(1, keep - 1)))
  const uniq = [...new Set(idx)]
  return uniq.map((i, j) => {
    const prev = uniq[Math.max(0, j - 1)], next = uniq[Math.min(uniq.length - 1, j + 1)]
    const dt = mt[next] - mt[prev], dd = dist[next] - dist[prev]
    const p = pts[i]
    return [
      hasPos && p.lat != null ? Math.round(p.lat * 1e5) : null,
      hasPos && p.lon != null ? Math.round(p.lon * 1e5) : null,
      ele[i] != null ? Math.round(ele[i]) : null,
      Math.round(dist[i]),
      dt > 0 ? Math.round(dd / dt * 100) : 0,
      hasHr && p.hr != null ? p.hr : null,
    ]
  })
}
