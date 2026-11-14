import { describe, it, expect } from 'vitest'
import { makeTrack, gpxOf } from './cardio-fixtures.js'
import { parseGpx } from './cardio-parse.js'
import { analyze } from './cardio-analyze.js'
import { addDone } from './cardio.js'
import {
  sportSessions, totals, yearsOf, byYear, monthly, weekly, yearToDate, records, trend, trainingDays, cardioByDay, MIN_FAST_M,
} from './cardio-stats.js'

const at = (y, m, d, h = 7) => new Date(y, m - 1, d, h).getTime()
/** One done session: `m` metres at `pace` s/km on that day, opts: sport, ele. */
const add = (S, y, mo, d, m, pace = 300, o = {}) => {
  const a = analyze(parseGpx(gpxOf(makeTrack({ legs: [[m, pace]], t0: at(y, mo, d), ele: o.ele }), { type: o.sport === 'bike' ? 'cycling' : 'running' })))
  return addDone(S, a)
}
const fresh = () => ({ cardio: {}, workouts: [] })

describe('totals and years', () => {
  const S = fresh()
  add(S, 2025, 3, 10, 5000, 300)
  add(S, 2025, 11, 2, 10000, 330)
  add(S, 2026, 1, 15, 8000, 300)
  add(S, 2026, 2, 3, 20000, 360, { sport: 'bike' })
  const run = sportSessions(S, 'run')

  it('splits by sport, oldest first', () => {
    expect(run.map(x => x.date)).toEqual(['2025-03-10', '2025-11-02', '2026-01-15'])
    expect(sportSessions(S, 'bike')).toHaveLength(1)
    expect(sportSessions({}, 'run')).toEqual([])
  })

  it('totals add up and the averages come from moving time', () => {
    const t = totals(run)
    expect(t.n).toBe(3)
    expect(t.distM).toBeGreaterThan(22900)
    expect(t.distM).toBeLessThan(23100)
    expect(t.avgPace).toBeGreaterThan(310)
    expect(t.avgPace).toBeLessThan(325)
    expect(t.longest.distM).toBeGreaterThan(9900)
    expect(totals([])).toMatchObject({ n: 0, distM: 0, avgPace: null, avgSpeed: 0, avgHr: null, longest: null })
  })

  it('one row per year, newest first', () => {
    expect(yearsOf(run)).toEqual([2026, 2025])
    const rows = byYear(run)
    expect(rows.map(r => [r.year, r.n])).toEqual([[2026, 1], [2025, 2]])
    expect(rows[1].distM).toBeGreaterThan(14900)
  })

  it('a year is twelve months, with the sessions in theirs', () => {
    const m = monthly(run, 2025)
    expect(m).toHaveLength(12)
    expect(m.map(x => x.n)).toEqual([0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0])
    expect(m[10].distM).toBeGreaterThan(9900)
    expect(monthly([], 2025).every(x => x.n === 0)).toBe(true)
  })

  it('heart rate is weighted by time', () => {
    const t = totals([{ avgHr: 150, movingSec: 3000, distM: 1 }, { avgHr: 130, movingSec: 1000, distM: 1 }, { distM: 1, movingSec: 500 }])
    expect(t.avgHr).toBe(145)
  })
})

describe('weeks and year to date', () => {
  it('the last weeks end with this one, Monday first', () => {
    const S = fresh()
    add(S, 2026, 11, 9, 5000)    // Monday, this week
    add(S, 2026, 11, 3, 4000)    // Tuesday of the week before
    const w = weekly(sportSessions(S, 'run'), '2026-11-12', 4, 1)
    expect(w.map(x => x.from)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09'])
    expect(w.map(x => x.n)).toEqual([0, 0, 1, 1])
    expect(w[3].distM).toBeGreaterThan(4900)
    // Sunday-first puts the 8th (a Sunday) at a week start.
    expect(weekly([], '2026-11-12', 1, 0)[0].from).toBe('2026-11-08')
  })

  it('year to date counts last year only up to the same day', () => {
    const S = fresh()
    add(S, 2025, 2, 1, 5000); add(S, 2025, 12, 1, 9000); add(S, 2026, 3, 1, 6000)
    const { cur, prev } = yearToDate(sportSessions(S, 'run'), 2026, '2026-11-12')
    expect(cur.n).toBe(1)
    expect(prev.n).toBe(1)                       // December 2025 is after 12 Nov
    expect(prev.distM).toBeLessThan(5100)
  })
})

describe('records and the trend', () => {
  it('finds the longest, the biggest climb, the fastest average and the best efforts', () => {
    const S = fresh()
    const a = add(S, 2026, 1, 5, 12000, 330, { ele: m => 400 + m / 100 })
    const b = add(S, 2026, 1, 12, 6000, 270)
    add(S, 2026, 1, 19, 2000, 200)                                   // too short to be "fastest"
    const r = records(sportSessions(S, 'run'), 'run')
    expect(r.longest.id).toBe(a)
    expect(r.mostClimb.id).toBe(a)
    expect(r.fastest.id).toBe(b)
    expect(MIN_FAST_M.run).toBe(3000)
    expect(r.best[1000].sec).toBeLessThan(205)            // from the 2 km one at 3:20/km
    expect(r.best[5000].x.id).toBe(b)
    expect(r.best[10000].x.id).toBe(a)
    expect(r.best[21098]).toBeUndefined()
    expect(records([], 'run')).toEqual({ longest: null, mostClimb: null, fastest: null, best: {} })
  })

  it('the trend is pace for a run and speed for a ride, one point per session over 1 km', () => {
    const S = fresh()
    add(S, 2026, 1, 5, 5000, 300)
    add(S, 2026, 1, 6, 500, 300)                                      // under 1 km
    add(S, 2026, 1, 7, 20000, 180, { sport: 'bike' })
    const p = trend(sportSessions(S, 'run'), 'run')
    expect(p).toHaveLength(1)
    expect(p[0].y).toBeGreaterThan(295)
    expect(p[0].y).toBeLessThan(305)
    const q = trend(sportSessions(S, 'bike'), 'bike')
    expect(q[0].y).toBeGreaterThan(19.5)
    expect(q[0].y).toBeLessThan(20.5)
  })
})

describe('training days', () => {
  it('counts a day once whether it had strength, cardio or both, within the window', () => {
    const S = { cardio: {}, workouts: [{ id: 'w1', d: '2026-11-02', start: at(2026, 11, 2), end: at(2026, 11, 2) + 3600000, entries: [] }, { id: 'w2', d: '2026-11-04', start: at(2026, 11, 4), end: at(2026, 11, 4) + 3600000, entries: [] }] }
    add(S, 2026, 11, 2, 3000)         // same day as w1
    add(S, 2026, 11, 3, 3000)
    add(S, 2026, 10, 1, 3000)         // outside the window
    expect([...trainingDays(S, '2026-11-01', '2026-11-30')].sort()).toEqual(['2026-11-02', '2026-11-03', '2026-11-04'])
    expect(trainingDays({}, '2026-01-01', '2026-12-31').size).toBe(0)
  })

  it('cardioByDay sums a day', () => {
    const S = fresh()
    add(S, 2026, 11, 2, 3000); add(S, 2026, 11, 2, 2000)
    const d = cardioByDay(S)['2026-11-02']
    expect(d.n).toBe(2)
    expect(d.m).toBeGreaterThan(4900)
  })
})
