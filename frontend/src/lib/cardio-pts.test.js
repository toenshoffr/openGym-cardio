import { describe, it, expect } from 'vitest'
import { packPts, unpackPts, ptsOf } from './cardio-pts.js'
import { makeTrack, gpxOf } from './cardio-fixtures.js'
import { parseGpx } from './cardio-parse.js'
import { analyze } from './cardio-analyze.js'

describe('packed route points', () => {
  it('round-trips rows exactly, nulls and negatives included', () => {
    const rows = [
      [4700000, 800000, 410, 0, 333, 142], [4700030, 800004, 411, 33, 335, 143], [4700061, 799990, 409, 66, 330, null],
      [null, null, null, 99, 0, null], [4700120, 799950, 397, 140, 345, 151], [4700120, 799950, -12, 200, 12000, 255],
    ]
    expect(unpackPts(packPts(rows))).toEqual(rows)
  })

  it('round-trips a long random profile, and large jumps', () => {
    let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const rows = []; let d = 0
    for (let i = 0; i < 300; i++) { d += Math.round(10 + rnd() * 300); rows.push([Math.round(4.7e6 + rnd() * 1e5), Math.round(8e5 + rnd() * 1e5), Math.round(rnd() * 3000 - 100), d, Math.round(rnd() * 2000), rnd() < 0.1 ? null : Math.round(60 + rnd() * 130)]) }
    expect(unpackPts(packPts(rows))).toEqual(rows)
    expect(unpackPts(packPts([[2147483000, -2147483000, 0, 4e9, 0, null]]))).toEqual([[2147483000, -2147483000, 0, 4e9, 0, null]])
  })

  it('an empty profile, and text that is not one', () => {
    expect(unpackPts(packPts([]))).toEqual([])
    for (const bad of ['', 'x', 'p1:2:', 'p1:1:A', 'p1:3:AAA', null, undefined, 42, 'p2:1:AAAAAA', 'p1:1:!!!!!!']) expect(unpackPts(bad)).toEqual([])
  })

  it('ptsOf reads an old array as it is, a string decoded, and nothing as empty', () => {
    const rows = [[1, 2, 3, 0, 5, 6], [2, 3, 4, 10, 5, 6]]
    expect(ptsOf({ pts: rows })).toBe(rows)
    expect(ptsOf({ pts: packPts(rows) })).toEqual(rows)
    expect(ptsOf({ pts: packPts(rows) })).toBe(ptsOf({ pts: packPts(rows) }))   // decoded once
    expect(ptsOf({})).toEqual([])
    expect(ptsOf(null)).toEqual([])
  })

  it('a session is about a third of the size it was', () => {
    const a = analyze(parseGpx(gpxOf(makeTrack({ legs: [[10000, 300]], hr: () => 150, ele: x => 400 + 20 * Math.sin(x / 500) }))))
    const rows = ptsOf(a)
    expect(rows.length).toBeLessThanOrEqual(150)
    expect(typeof a.pts).toBe('string')
    expect(a.pts.length).toBeLessThan(JSON.stringify(rows).length / 2.2)
    expect(JSON.stringify(a).length).toBeLessThan(4500)
  })
})
