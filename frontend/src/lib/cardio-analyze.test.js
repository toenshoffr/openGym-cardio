import { describe, it, expect } from 'vitest'
import { makeTrack, gpxOf, tcxOf, fitOf } from './cardio-fixtures.js'
import { parseGpx, parseTcx, parseActivity, sportOf, xmlKind } from './cardio-parse.js'
import { parseFit } from './cardio-fit.js'
import { analyze, climb, bestEffort, haversine } from './cardio-analyze.js'
import { ptsOf } from './cardio-pts.js'

describe('sportOf', () => {
  it('maps Strava, Garmin and FIT names', () => {
    expect(sportOf('running')).toBe('run')
    expect(sportOf('Biking')).toBe('bike')
    expect(sportOf('VirtualRide')).toBe('bike')
    expect(sportOf('trail_running')).toBe('run')
    expect(sportOf('9')).toBe('run')
    expect(sportOf('1')).toBe('bike')
    expect(sportOf('swimming')).toBe(null)
    expect(sportOf(null)).toBe(null)
  })
})

describe('GPX', () => {
  it('reads points, name, sport and heart rate', () => {
    const g = parseGpx(gpxOf(makeTrack({ legs: [[1000, 300]], hr: () => 150 }), { name: 'Park &amp; Ride' }))
    expect(g.sport).toBe('run')
    expect(g.name).toBe('Park & Ride')
    expect(g.points.length).toBe(301)
    expect(g.points[5].hr).toBe(150)
    expect(g.start).toBe(g.points[0].t)
    expect(xmlKind(gpxOf(makeTrack()))).toBe('gpx')
  })
  it('refuses a file without timed points', () => {
    expect(() => parseGpx('<gpx><trk><trkseg><trkpt lat="1" lon="2"></trkpt></trkseg></trk></gpx>')).toThrow(/No track points/)
  })
})

describe('analyze', () => {
  it('measures a steady 5 km at 5:00/km', () => {
    const a = analyze(parseGpx(gpxOf(makeTrack({ legs: [[5000, 300]] }))))
    expect(a.distM).toBeGreaterThan(4990)
    expect(a.distM).toBeLessThan(5010)
    expect(a.movingSec).toBeGreaterThan(1495)
    expect(a.movingSec).toBeLessThan(1505)
    expect(a.splits).toHaveLength(5)
    for (const s of a.splits) { expect(s.pace).toBeGreaterThan(298); expect(s.pace).toBeLessThan(302); expect(s.full).toBe(true) }
    expect(a.best[1000].sec).toBeGreaterThan(298)
    expect(a.best[5000].sec).toBeLessThan(1505)
    expect(a.best[10000]).toBeUndefined()
  })

  it('keeps a stop out of the moving time and out of the split paces', () => {
    const a = analyze(parseGpx(gpxOf(makeTrack({ legs: [[4000, 300]], pauseAtM: 2000 }))))
    expect(a.elapsedSec - a.movingSec).toBeGreaterThan(55)
    expect(a.movingSec).toBeLessThan(1210)
    for (const s of a.splits) expect(s.pace).toBeLessThan(305)
  })

  it('finds a negative split and a short last kilometre', () => {
    const a = analyze(parseGpx(gpxOf(makeTrack({ legs: [[2000, 330], [2500, 270]] }))))
    expect(a.splits).toHaveLength(5)
    expect(a.splits[0].pace).toBeGreaterThan(325)
    expect(a.splits[3].pace).toBeLessThan(275)
    const last = a.splits[4]
    expect(last.full).toBe(false)
    expect(last.distM).toBeGreaterThan(490)
    expect(last.distM).toBeLessThan(510)
    expect(last.pace).toBeGreaterThan(265)
    expect(last.pace).toBeLessThan(275)
  })

  it('drops a last stretch under 100 m', () => {
    const a = analyze(parseGpx(gpxOf(makeTrack({ legs: [[3050, 300]] }))))
    expect(a.splits).toHaveLength(3)
  })

  it('finds the fastest 1 km inside a longer run', () => {
    const a = analyze(parseGpx(gpxOf(makeTrack({ legs: [[1500, 330], [1000, 240], [2500, 330]] }))))
    expect(a.best[1000].sec).toBeGreaterThan(238)
    expect(a.best[1000].sec).toBeLessThan(242)
    expect(a.best[1000].startM).toBeGreaterThan(1450)
    expect(a.best[1000].startM).toBeLessThan(1550)
  })

  it('adds up climb with a threshold, so GPS jitter is not a hill', () => {
    const jitter = analyze(parseGpx(gpxOf(makeTrack({ legs: [[3000, 300]], ele: m => 400 + (Math.round(m) % 2) }))))
    expect(jitter.elevGain).toBeLessThan(5)
    const hill = analyze(parseGpx(gpxOf(makeTrack({ legs: [[3000, 300]], ele: m => 400 + m / 20 }))))
    expect(hill.elevGain).toBeGreaterThan(140)
    expect(hill.elevGain).toBeLessThan(155)
    expect(hill.elevLoss).toBe(0)
    expect(hill.splits[1].elev).toBeGreaterThan(45)
    expect(climb([100, 110, 100, 111, 101]).gain).toBe(21)
  })

  it('reads heart rate per split', () => {
    const a = analyze(parseGpx(gpxOf(makeTrack({ legs: [[3000, 300]], hr: m => (m < 1500 ? 140 : 160) }))))
    expect(a.avgHr).toBeGreaterThan(148)
    expect(a.avgHr).toBeLessThan(152)
    expect(a.maxHr).toBe(160)
    expect(a.splits[0].hr).toBe(140)
    expect(a.splits[2].hr).toBe(160)
  })

  it('keeps a small profile and a route', () => {
    const a = analyze(parseGpx(gpxOf(makeTrack({ legs: [[10000, 300]] }))))
    const rows = ptsOf(a)
    expect(rows.length).toBeLessThanOrEqual(150)
    expect(rows[0][3]).toBe(0)
    expect(rows.at(-1)[3]).toBeGreaterThan(9900)
    expect(rows[10][4]).toBeGreaterThan(320)   // 3.33 m/s, ×100
    expect(rows[10][4]).toBeLessThan(345)
    expect(JSON.stringify(a).length).toBeLessThan(5000)
  })

  it('refuses a file with no distance at all', () => {
    const pts = makeTrack({ legs: [[1000, 300]] }).map(p => ({ ...p, lat: null, lon: null }))
    expect(() => analyze({ points: pts, laps: [] })).toThrow(/No distance/)
  })

  it('uses a treadmill file own distance when there is no GPS', () => {
    const pts = makeTrack({ legs: [[2000, 360]] }).map((p, i) => ({ ...p, lat: null, lon: null, d: i * 1000 / 360 }))
    const a = analyze({ points: pts, laps: [], sport: 'run', start: pts[0].t })
    expect(a.distM).toBeGreaterThan(1995)
    expect(a.splits).toHaveLength(2)
    expect(ptsOf(a)[0][0]).toBe(null)
  })

  it('doubles a per-leg running cadence', () => {
    const pts = makeTrack({ legs: [[2000, 300]] }).map(p => ({ ...p, cad: 88 }))
    expect(analyze({ points: pts, laps: [], sport: 'run', start: pts[0].t }).avgCad).toBe(176)
    expect(analyze({ points: pts, laps: [], sport: 'bike', start: pts[0].t }).avgCad).toBe(88)
  })
})

describe('bad readings', () => {
  const M = 111195
  const run = (pts, sport = 'running') => analyze(parseGpx(gpxOf(pts, { type: sport })))
  const clean = () => makeTrack({ legs: [[5000, 300]], hr: () => 150 })

  it('one GPS fix 400 m off adds no distance and makes no record kilometre', () => {
    const p = clean(); p[1500 - 1] = { ...p[1500 - 1], lat: p[1500 - 1].lat + 400 / M }
    const a = run(p)
    expect(a.distM).toBeGreaterThan(4990); expect(a.distM).toBeLessThan(5010)
    expect(a.best[1000].sec).toBeGreaterThan(295)
    expect(a.best[5000].sec).toBeGreaterThan(1495)
    for (const s of a.splits) { expect(s.pace).toBeGreaterThan(295); expect(s.pace).toBeLessThan(305) }
    // the glitch is gone from the route too
    const rows = ptsOf(a)
    expect(rows.every(r => r[0] == null || Math.abs(r[0] - 4700000) < 6000)).toBe(true)
  })

  it('several glitches in a row, and one at the very start', () => {
    const p = clean()
    for (const i of [600, 601, 602]) p[i] = { ...p[i], lon: p[i].lon + 0.01 }
    p[1] = { ...p[1], lat: p[1].lat + 300 / M }
    const a = run(p)
    expect(a.distM).toBeGreaterThan(4980); expect(a.distM).toBeLessThan(5020)
  })

  it('a real jump after a gap is believed once there is time to have covered it', () => {
    const p = clean(); p.forEach((x, i) => { if (i > 750) { x.t += 120000; x.lat += 600 / M } })   // 600 m in 120 s: 5 m/s
    expect(run(p).distM).toBeGreaterThan(5500)
  })

  it('a position that stays wrong is dropped only until the clock has caught up with it', () => {
    const p = clean(); for (let i = 900; i < 1500; i++) p[i] = { ...p[i], lat: p[i].lat + 900 / M }   // 900 m off, for good
    const a = run(p)
    expect(a.distM).toBeGreaterThan(5000)          // the offset is believed again, late
    expect(a.distM).toBeLessThan(6000)             // but it is not 600 s of nothing
  })

  it('a ride may be faster than a run, and a ride saved as a run is not thrown away', () => {
    const fast = makeTrack({ legs: [[5000, 40]] })     // 25 m/s
    expect(run(fast, 'cycling').distM).toBeGreaterThan(4990)
    // On foot that is impossible, but it is every fix of the file, so it is the limit that is wrong.
    expect(run(fast, 'running').distM).toBeGreaterThan(4990)
  })

  it('heart rate of 0 or over 250 is no reading: not in a kilometre, not in the average', () => {
    const p = clean().map((x, i) => (i > 600 && i < 700 ? { ...x, hr: 0 } : i === 100 ? { ...x, hr: 255 } : x))
    const a = run(p)
    expect(a.avgHr).toBe(150); expect(a.maxHr).toBe(150)
    expect(a.splits.map(s => s.hr)).toEqual([150, 150, 150, 150, 150])
  })

  it('does not change the points of the file it was given', () => {
    const parsed = parseGpx(gpxOf(clean().map((x, i) => (i === 700 ? { ...x, lat: x.lat + 400 / M, hr: 0 } : x))))
    const before = JSON.stringify(parsed.points)
    analyze(parsed)
    expect(JSON.stringify(parsed.points)).toBe(before)
  })
})

describe('TCX', () => {
  it('reads laps, distance and sport', () => {
    const t = parseTcx(tcxOf(makeTrack({ legs: [[3000, 300]] }), { sport: 'Biking' }))
    expect(t.sport).toBe('bike')
    expect(t.laps.length).toBeGreaterThanOrEqual(3)
    const a = analyze(t)
    expect(a.sport).toBe('bike')
    expect(a.distM).toBeGreaterThan(2990)
    expect(a.laps[0].distM).toBeGreaterThan(990)
    expect(a.laps[0].pace).toBeGreaterThan(295)
    expect(a.laps[0].hr).toBe(150)
  })
})

describe('FIT', () => {
  it('reads records and the sport', () => {
    const pts = makeTrack({ legs: [[2000, 300]], hr: () => 140 })
    const f = parseFit(fitOf(pts, { sport: 2 }))
    expect(f.sport).toBe('bike')
    expect(f.points.length).toBe(pts.length)
    expect(f.points[100].lat).toBeCloseTo(pts[100].lat, 5)
    expect(f.points[100].ele).toBeCloseTo(400, 0)
    expect(f.points[100].hr).toBe(140)
    expect(f.points[100].t).toBe(pts[100].t)
    const a = analyze(f)
    expect(a.distM).toBeGreaterThan(1990)
    expect(a.splits).toHaveLength(2)
  })
  it('reads a gzipped file through parseActivity, and refuses what it cannot read', async () => {
    const bytes = fitOf(makeTrack({ legs: [[1000, 300]] }), { sport: 1 })
    expect((await parseActivity(bytes)).sport).toBe('run')
    const gz = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
    expect((await parseActivity(gz)).source).toBe('fit')
    await expect(parseActivity(new TextEncoder().encode('hello'))).rejects.toMatchObject({ code: 'format' })
    await expect(parseActivity(new Uint8Array([0x50, 0x4b, 3, 4]))).rejects.toMatchObject({ code: 'zip' })
  })
  it('refuses a truncated header', () => {
    expect(() => parseFit(new Uint8Array(5))).toThrow()
  })
})

describe('helpers', () => {
  it('haversine is about 111 km per degree of latitude', () => {
    expect(haversine(47, 8, 48, 8)).toBeGreaterThan(111000)
    expect(haversine(47, 8, 48, 8)).toBeLessThan(111400)
  })
  it('bestEffort is null for a shorter activity', () => {
    expect(bestEffort([0, 500, 900], [0, 100, 200], 1000)).toBe(null)
  })
})
