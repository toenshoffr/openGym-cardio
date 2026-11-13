import { describe, it, expect } from 'vitest'
import { makeTrack, gpxOf, fitOf } from './cardio-fixtures.js'
import { importActivityFiles } from './cardio-import.js'
import { addPlanned, cardioList, dayOf } from './cardio.js'

const file = (name, data) => ({ name, arrayBuffer: async () => (typeof data === 'string' ? new TextEncoder().encode(data) : data).buffer.slice(0) })
const store = (S = { cardio: {} }) => ({ get: () => S, update: fn => fn(S), S })
const T = new Date(2026, 10, 10, 7).getTime()

describe('importActivityFiles', () => {
  it('adds a file, skips the same one again, and reports one that is not an activity', async () => {
    const st = store()
    const gpx = gpxOf(makeTrack({ legs: [[3000, 300]], t0: T }))
    const r = await importActivityFiles([file('a.gpx', gpx), file('a-again.gpx', gpx), file('notes.txt', 'hello')], st.get, st.update)
    expect(r.map(x => x.status)).toEqual(['added', 'duplicate', 'error'])
    expect(r[2].code).toBe('format')
    expect(cardioList(st.S)).toHaveLength(1)
    expect(cardioList(st.S)[0]).toMatchObject({ status: 'done', sport: 'run', date: dayOf(T) })
  })

  it('fills the planned session of that day on its own', async () => {
    const st = store()
    const id = addPlanned(st.S, { sport: 'run', date: dayOf(T), distM: 3000 })
    const [r] = await importActivityFiles([file('a.gpx', gpxOf(makeTrack({ legs: [[3000, 300]], t0: T })))], st.get, st.update)
    expect(r).toMatchObject({ status: 'added', id, planned: true })
    expect(cardioList(st.S)).toHaveLength(1)
    expect(st.S.cardio[id].plan.distM).toBe(3000)
  })

  it('fills the session the person picked, even on another day', async () => {
    const st = store()
    const id = addPlanned(st.S, { sport: 'run', date: '2026-11-20' })
    const [r] = await importActivityFiles([file('a.gpx', gpxOf(makeTrack({ legs: [[3000, 300]], t0: T })))], st.get, st.update, { matchId: id })
    expect(r.id).toBe(id)
    expect(st.S.cardio[id]).toMatchObject({ status: 'done', date: dayOf(T) })
  })

  it('reads a FIT file and guesses a ride from a fast average when the file has no sport', async () => {
    const st = store()
    const fit = fitOf(makeTrack({ legs: [[6000, 120]], t0: T }), { sport: 0 })
    const [r] = await importActivityFiles([file('a.fit', fit)], st.get, st.update)
    expect(r.status).toBe('added')
    expect(st.S.cardio[r.id].sport).toBe('bike')
  })

  it('a file the browser cannot read is an error, not a crash', async () => {
    const st = store()
    const [r] = await importActivityFiles([{ name: 'x', arrayBuffer: async () => { throw new Error('gone') } }], st.get, st.update)
    expect(r).toMatchObject({ status: 'error', code: 'read' })
  })
})
