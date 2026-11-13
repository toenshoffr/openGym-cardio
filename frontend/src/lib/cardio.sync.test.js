// Cardio sessions in the sync: merged one session at a time, wiped by a reset like the other
// per-key maps, and kept through the server for an older app that has never heard of them.
import { describe, it, expect } from 'vitest'
import { mergeStates, stampEdits, resetIdsOf, sinceReset } from './sync-merge.js'
import { stampPut } from '../../../api/sync-stamps.js'

const clone = v => JSON.parse(JSON.stringify(v))
const T = 1_800_000_000_000
const C = (id, title, status = 'planned') => ({ id, sport: 'run', date: '2026-11-10', status, title, plan: { distM: 5000 }, _ts: 1 })
const base = () => ({ _ts: T, unit: 'kg', workouts: [], routines: [], week: {}, cardio: { a: C('a', 'A'), b: C('b', 'B') } })
const edit = (prev, at, mut) => { const n = clone(prev); mut(n); n._ts = at; return stampEdits(prev, n, at) }

describe('cardio merges one session at a time', () => {
  it('a run imported on the phone and a ride planned on the laptop both stay', () => {
    const s0 = stampEdits(null, base(), T)
    const phone = edit(s0, T + 10, s => { s.cardio.a = { ...s.cardio.a, status: 'done', distM: 5012 } })
    const desk = edit(s0, T + 20, s => { s.cardio.c = C('c', 'Ride') })
    for (const m of [mergeStates(phone, desk), mergeStates(desk, phone)]) {
      expect(m.cardio.a).toMatchObject({ status: 'done', distM: 5012 })
      expect(m.cardio.b.title).toBe('B')
      expect(m.cardio.c.title).toBe('Ride')
    }
  })

  it('a removed session stays removed', () => {
    const s0 = stampEdits(null, base(), T)
    const phone = edit(s0, T + 10, s => { delete s.cardio.a })
    const desk = edit(s0, T + 5, s => { s.cardio.b.title = 'B2' })
    for (const m of [mergeStates(phone, desk), mergeStates(desk, phone)]) {
      expect(Object.keys(m.cardio)).toEqual(['b'])
      expect(m.cardio.b.title).toBe('B2')
    }
  })

  it('a reset wipes them', () => {
    const s = base()
    const ids = resetIdsOf(s)
    expect(ids.cardio.sort()).toEqual(['a', 'b'])
    expect(sinceReset(s, T + 1, ids).cardio).toEqual({})
  })
})

describe('an older app that does not know them', () => {
  it('keeps them through the server when it sends a document without them', () => {
    const cur = stampEdits(null, base(), T)
    const old = clone(cur)
    delete old.cardio
    const out = stampPut(clone(cur), old, { overRead: true, stamped: false, now: T + 100 })
    expect(out.cardio).toEqual(cur.cardio)
  })
})
