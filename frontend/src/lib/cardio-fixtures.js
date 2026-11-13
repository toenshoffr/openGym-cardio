// Test helpers (not shipped: only the cardio tests import this): synthetic activities with
// exactly known pace, so every number the analysis reports can be checked by hand.
const M_PER_DEG = 111195
const T0 = Date.UTC(2026, 10, 10, 7, 0, 0)

/**
 * A straight run north from 47.0, one point a second. `legs` is [[metres, secPerKm], …];
 * `pauseAtM` inserts a 60 s stop there (standing still), `ele(m)` gives the elevation.
 */
export function makeTrack({ legs = [[5000, 300]], pauseAtM = null, ele = () => 400, hr = null, t0 = T0 } = {}) {
  const pts = []
  let m = 0, t = t0, paused = false
  const push = () => pts.push({ t, lat: 47 + m / M_PER_DEG, lon: 8, ele: ele(m), hr: hr ? hr(m) : null, cad: null, d: null })
  push()
  for (const [len, pace] of legs) {
    const end = m + len, v = 1000 / pace
    while (m < end - 1e-9) {
      if (pauseAtM != null && !paused && m >= pauseAtM) {
        paused = true
        for (let i = 0; i < 60; i++) { t += 1000; push() }
      }
      m = Math.min(end, m + v); t += 1000; push()
    }
  }
  return pts
}

export const gpxOf = (pts, { name = 'Morning Run', type = 'running' } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="test" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
 <metadata><name>ignored</name></metadata>
 <trk><name>${name}</name><type>${type}</type><trkseg>
${pts.map(p => `  <trkpt lat="${p.lat}" lon="${p.lon}"><ele>${p.ele}</ele><time>${new Date(p.t).toISOString()}</time>${p.hr != null ? `<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${p.hr}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>` : ''}</trkpt>`).join('\n')}
 </trkseg></trk></gpx>`

export const tcxOf = (pts, { sport = 'Running', lapEvery = 1000 } = {}) => {
  // Distance by haversine-free approximation: straight line north.
  const d = p => (p.lat - 47) * M_PER_DEG
  const laps = []
  let cur = null
  for (const p of pts) {
    if (!cur || d(p) - cur.d0 >= lapEvery) { cur = { d0: d(p), t0: p.t, pts: [] }; laps.push(cur) }
    cur.pts.push(p)
  }
  return `<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities><Activity Sport="${sport}"><Id>${new Date(pts[0].t).toISOString()}</Id>
${laps.map(l => `<Lap StartTime="${new Date(l.t0).toISOString()}"><TotalTimeSeconds>${(l.pts.at(-1).t - l.t0) / 1000}</TotalTimeSeconds><DistanceMeters>${d(l.pts.at(-1)) - l.d0}</DistanceMeters><AverageHeartRateBpm><Value>150</Value></AverageHeartRateBpm><Track>
${l.pts.map(p => `<Trackpoint><Time>${new Date(p.t).toISOString()}</Time><Position><LatitudeDegrees>${p.lat}</LatitudeDegrees><LongitudeDegrees>${p.lon}</LongitudeDegrees></Position><AltitudeMeters>${p.ele}</AltitudeMeters><DistanceMeters>${d(p)}</DistanceMeters></Trackpoint>`).join('')}
</Track></Lap>`).join('\n')}
</Activity></Activities></TrainingCenterDatabase>`
}

/** A minimal FIT file: records (with a compressed-timestamp one) and a session, built by hand. */
export function fitOf(pts, { sport = 2 } = {}) {
  const FIT_EPOCH = 631065600
  const out = []
  const u16 = v => [v & 255, v >> 8 & 255], u32 = v => [v & 255, v >> 8 & 255, v >> 16 & 255, v >>> 24 & 255]
  const s32 = v => u32(v >>> 0)
  // definition for record (local 0): timestamp(253,u32), lat(0,s32), lon(1,s32), alt(2,u16), hr(3,u8), dist(5,u32)
  out.push(0x40, 0, 0, ...u16(20), 6, 253, 4, 0x86, 0, 4, 0x85, 1, 4, 0x85, 2, 2, 0x84, 3, 1, 0x02, 5, 4, 0x86)
  const start = pts[0].t
  for (const p of pts) {
    out.push(0, ...u32(Math.round(p.t / 1000) - FIT_EPOCH), ...s32(Math.round(p.lat * 2147483648 / 180)), ...s32(Math.round(p.lon * 2147483648 / 180)),
      ...u16(Math.round((p.ele + 500) * 5)), p.hr ?? 0xFF, ...u32(Math.round(((p.lat - 47) * M_PER_DEG) * 100)))
  }
  // session (local 1): start_time(2,u32), sport(5,enum)
  out.push(0x41, 0, 0, ...u16(18), 2, 2, 4, 0x86, 5, 1, 0)
  out.push(1, ...u32(Math.round(start / 1000) - FIT_EPOCH), sport)
  const header = [14, 0x20, 0, 0, ...u32(out.length), 0x2E, 0x46, 0x49, 0x54, 0, 0]
  return new Uint8Array([...header, ...out, 0, 0])
}
