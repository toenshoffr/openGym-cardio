import { describe, it, expect } from 'vitest'
import { makeTrack, gpxOf } from './cardio-fixtures.js'
import { parseGpx } from './cardio-parse.js'
import { analyze } from './cardio-analyze.js'
import {
  addPlanned, addDone, editSession, removeSession, suggestMatch, findDuplicate, cardioList,
  fmtPace, fmtClock, fmtKm, speedLabel, weekStart, weekTotals, dayOf,
} from './cardio.js'
import { insightsOf } from './cardio-insights.js'

const run = (legs, t0, extra = {}) => analyze(parseGpx(gpxOf(makeTrack({ legs, t0, ...extra }))))
const T = (y, m, d, h = 7) => new Date(y, m - 1, d, h).getTime()

describe('formatting', () => {
  it('formats pace, clock, distance and bike speed', () => {
    expect(fmtPace(312)).toBe('5:12')
    expect(fmtPace(299.7)).toBe('5:00')
    expect(fmtPace(0)).toBe('–')
    expect(fmtClock(3727)).toBe('1:02:07')
    expect(fmtClock(607)).toBe('10:07')
    expect(fmtKm(10420)).toBe('10.42')
    expect(fmtKm(5000)).toBe('5')
    expect(fmtKm(5100)).toBe('5.1')
    expect(fmtKm(120400)).toBe('120')
    expect(speedLabel('run', 300)).toEqual({ value: '5:00', unit: '/km' })
    expect(speedLabel('bike', 120)).toEqual({ value: '30', unit: 'km/h' })
  })
})

describe('planning and importing', () => {
  const day = dayOf(T(2026, 11, 10))
  it('plans a session and edits it', () => {
    const s = { cardio: {} }
    const id = addPlanned(s, { sport: 'run', date: day, title: 'Long run', distM: 15000, note: 'easy' })
    expect(s.cardio[id]).toMatchObject({ status: 'planned', sport: 'run', date: day, plan: { distM: 15000, note: 'easy' } })
    editSession(s, id, { date: '2026-11-12', plan: { distM: 12000, note: '' } })
    expect(s.cardio[id].date).toBe('2026-11-12')
    expect(s.cardio[id].plan).toEqual({ distM: 12000 })
    expect(removeSession(s, id)).toBe(true)
    expect(s.cardio).toEqual({})
  })

  it('creates the map when the profile has none', () => {
    const s = {}
    addPlanned(s, { sport: 'bike', date: day })
    expect(Object.keys(s.cardio)).toHaveLength(1)
  })

  it('fills the planned session of that day and keeps its plan', () => {
    const s = { cardio: {} }
    const other = addPlanned(s, { sport: 'bike', date: day })
    const id = addPlanned(s, { sport: 'run', date: day, distM: 5000 })
    const a = run([[5000, 300]], T(2026, 11, 10))
    expect(suggestMatch(s, a)?.id).toBe(id)
    expect(addDone(s, a, { matchId: id }).toString()).toBe(id)
    expect(s.cardio[id]).toMatchObject({ status: 'done', sport: 'run', date: day, plan: { distM: 5000 } })
    expect(s.cardio[id].splits).toHaveLength(5)
    expect(s.cardio[other].status).toBe('planned')
    expect(Object.keys(s.cardio)).toHaveLength(2)
  })

  it('matches a day either side, the closest first, and not a different sport', () => {
    const s = { cardio: {} }
    const dayBefore = addPlanned(s, { sport: 'run', date: '2026-11-09', distM: 5000 })
    const sameDay = addPlanned(s, { sport: 'run', date: day, distM: 20000 })
    addPlanned(s, { sport: 'bike', date: day })
    addPlanned(s, { sport: 'run', date: '2026-11-13' })
    const a = run([[5000, 300]], T(2026, 11, 10))
    expect(suggestMatch(s, a).id).toBe(sameDay)
    delete s.cardio[sameDay]
    expect(suggestMatch(s, a).id).toBe(dayBefore)
    expect(suggestMatch({ cardio: {} }, a)).toBe(null)
  })

  it('picks the closer distance between two plans on one day', () => {
    const s = { cardio: {} }
    addPlanned(s, { sport: 'run', date: day, distM: 21000 })
    const near = addPlanned(s, { sport: 'run', date: day, distM: 5000 })
    expect(suggestMatch(s, run([[5000, 300]], T(2026, 11, 10))).id).toBe(near)
  })

  it('does not import the same file twice', () => {
    const s = { cardio: {} }
    const a = run([[3000, 300]], T(2026, 11, 10))
    expect(findDuplicate(s, a)).toBe(null)
    addDone(s, a)
    expect(findDuplicate(s, a)).toMatchObject({ status: 'done' })
    expect(findDuplicate(s, run([[3000, 300]], T(2026, 11, 10) + 3600000))).toBe(null)
  })

  it('names a session after the file and takes the sport from the file', () => {
    const s = { cardio: {} }
    const a = analyze(parseGpx(gpxOf(makeTrack({ legs: [[2000, 300]] }), { name: 'Lunch loop', type: 'cycling' })))
    const id = addDone(s, a)
    expect(s.cardio[id]).toMatchObject({ title: 'Lunch loop', sport: 'bike', status: 'done' })
    expect(s.cardio[id].name).toBeUndefined()
  })

  it('lists newest first', () => {
    const s = { cardio: {} }
    addPlanned(s, { sport: 'run', date: '2026-11-01' })
    addPlanned(s, { sport: 'run', date: '2026-11-20' })
    expect(cardioList({ cardio: s.cardio }).map(x => x.date)).toEqual(['2026-11-20', '2026-11-01'])
    expect(cardioList({})).toEqual([])
  })
})

describe('weeks', () => {
  it('starts a week on Monday and sums the done sessions in it', () => {
    expect(weekStart('2026-11-12')).toBe('2026-11-09')
    expect(weekStart('2026-11-15')).toBe('2026-11-09')
    expect(weekStart('2026-11-16')).toBe('2026-11-16')
    const s = { cardio: {} }
    addDone(s, run([[5000, 300]], T(2026, 11, 10)))
    addDone(s, run([[3000, 300]], T(2026, 11, 14)))
    addDone(s, run([[3000, 300]], T(2026, 11, 16)))
    addPlanned(s, { sport: 'run', date: '2026-11-11', distM: 9000 })
    const w = weekTotals(s, '2026-11-09')
    expect(w.count).toBe(2)
    expect(w.distM).toBeGreaterThan(7980)
  })
})

describe('insights', () => {
  const ids = (x, S) => insightsOf(x, S).map(i => i.id)
  const withSessions = (...items) => {
    const S = { cardio: {} }
    const out = items.map(a => S.cardio[addDone(S, a)])
    return { S, out }
  }

  it('calls a faster second half a negative split', () => {
    const { S, out } = withSessions(run([[3000, 330], [3000, 300]], T(2026, 11, 10)))
    const i = insightsOf(out[0], S).find(x => x.id === 'negative')
    expect(i.pct).toBeGreaterThan(8)
  })
  it('calls a slower second half a fade, and a steady one even', () => {
    expect(ids(...(() => { const { S, out } = withSessions(run([[3000, 300], [3000, 330]], T(2026, 11, 10))); return [out[0], S] })())).toContain('fade')
    const { S, out } = withSessions(run([[6000, 300]], T(2026, 11, 10)))
    expect(ids(out[0], S)).toContain('even')
  })
  it('finds a personal best only against earlier sessions of the same sport', () => {
    const { S, out } = withSessions(
      run([[5000, 330]], T(2026, 11, 1)),
      run([[5000, 300]], T(2026, 11, 8)),
    )
    const pr = insightsOf(out[1], S).find(x => x.id === 'pr')
    expect(pr.distM).toBe(5000)
    expect(pr.sec).toBeLessThan(pr.prevSec)
    expect(ids(out[0], S)).not.toContain('pr')
  })
  it('notes heart rate drift at a steady pace', () => {
    const { S, out } = withSessions(run([[6000, 300]], T(2026, 11, 10), { hr: m => 140 + m / 6000 * 20 }))
    expect(insightsOf(out[0], S).find(x => x.id === 'drift').pct).toBeGreaterThan(6)
  })
  it('notes a hilly route and a plan that was beaten', () => {
    const S = { cardio: {} }
    const planned = addPlanned(S, { sport: 'run', date: '2026-11-10', distM: 4000 })
    const id = addDone(S, run([[5000, 300]], T(2026, 11, 10), { ele: m => 400 + m / 40 }), { matchId: planned })
    const got = insightsOf(S.cardio[id], S)
    expect(got.find(x => x.id === 'hilly').perKm).toBeGreaterThan(20)
    expect(got.find(x => x.id === 'plan').pct).toBeGreaterThan(20)
  })
  it('compares the week with the four before it', () => {
    const items = [T(2026, 10, 12), T(2026, 10, 19), T(2026, 10, 26), T(2026, 11, 2)].map(t => run([[5000, 300]], t))
    items.push(run([[12000, 300]], T(2026, 11, 10)))
    const { S, out } = withSessions(...items)
    expect(insightsOf(out.at(-1), S).find(x => x.id === 'week').pct).toBeGreaterThan(100)
  })
  it('says nothing it cannot back up on a short, plain session', () => {
    const { S, out } = withSessions(run([[1500, 300]], T(2026, 11, 10)))
    expect(insightsOf(out[0], S)).toEqual([])
  })
})
