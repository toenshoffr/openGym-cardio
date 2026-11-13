import { describe, it, expect } from 'vitest'
import { makeTrack, gpxOf } from './cardio-fixtures.js'
import { syncGarmin, garminMessage, MAX_FILES } from './garmin-sync.js'
import { addDone, addPlanned, cardioList, dayOf } from './cardio.js'
import { analyze } from './cardio-analyze.js'
import { parseGpx } from './cardio-parse.js'

const T0 = new Date(2026, 10, 10, 7).getTime()
const gpx = (t0, m = 2000) => gpxOf(makeTrack({ legs: [[m, 300]], t0 }))
const toB64 = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)))

/** A fake server: a Garmin list and the files, recording what it was asked. */
function fake(acts, { fileError = null } = {}) {
  const calls = []
  const api = async (path, { body }) => {
    const b = JSON.parse(body)
    calls.push(b)
    if (b.op === 'list') {
      const items = acts.slice(b.start, b.start + b.limit)
      return { items, more: b.start + b.limit < acts.length, next: b.start + items.length }
    }
    if (fileError) throw Object.assign(new Error('x'), { code: fileError })
    const a = acts.find(x => x.id === b.activity)
    return { name: a.id + '.gpx', data: toB64(gpx(a.start)) }
  }
  return { api, calls }
}
const store = () => { const S = { cardio: {} }; return { S, getS: () => S, update: fn => fn(S) } }
const act = (i, sport = 'run') => ({ id: String(100 + i), sport, name: 'A' + i, start: T0 + i * 86400000, distM: 2000, sec: 600 })

describe('syncGarmin', () => {
  it('imports what is new, oldest first, and says so', async () => {
    const st = store(), g = fake([act(2), act(1), act(0)])
    const r = await syncGarmin({ api: g.api, connId: 'c1', ...st })
    expect(r).toMatchObject({ added: 3, errors: 0, left: 0, stopped: null })
    expect(g.calls.filter(c => c.op === 'file').map(c => c.activity)).toEqual(['100', '101', '102'])
    expect(cardioList(st.S)).toHaveLength(3)
  })

  it('leaves out what is already here, and downloads nothing for it', async () => {
    const st = store()
    addDone(st.S, analyze(parseGpx(gpx(T0))))
    const g = fake([act(1), act(0)])
    const r = await syncGarmin({ api: g.api, connId: 'c1', ...st })
    expect(r).toMatchObject({ added: 1, dupes: 1 })
    expect(g.calls.filter(c => c.op === 'file')).toHaveLength(1)
  })

  it('fills a planned session', async () => {
    const st = store()
    const id = addPlanned(st.S, { sport: 'run', date: dayOf(T0), distM: 2000 })
    const r = await syncGarmin({ api: fake([act(0)]).api, connId: 'c1', ...st })
    expect(r).toMatchObject({ added: 1, planned: 1 })
    expect(st.S.cardio[id].status).toBe('done')
  })

  it('stops paging at a page with nothing new', async () => {
    const st = store()
    const many = Array.from({ length: 120 }, (_, i) => act(i))
    for (const a of many) addDone(st.S, analyze(parseGpx(gpx(a.start, 600))))
    const g = fake(many)
    const r = await syncGarmin({ api: g.api, connId: 'c1', ...st })
    expect(r.added).toBe(0)
    expect(g.calls.filter(c => c.op === 'list')).toHaveLength(1)
  })

  it('caps one sync, and says how many are left', async () => {
    const st = store()
    const many = Array.from({ length: MAX_FILES + 5 }, (_, i) => act(i))
    const r = await syncGarmin({ api: fake(many).api, connId: 'c1', ...st })
    expect(r.added).toBe(MAX_FILES)
    expect(r.left).toBe(5)
    expect(garminMessage(r)).toContain('5 more to get')
  })

  it('stops for a refused key, carries on past a file it cannot read', async () => {
    const st = store()
    const r1 = await syncGarmin({ api: fake([act(0), act(1)], { fileError: 'key' }).api, connId: 'c1', ...st })
    expect(r1).toMatchObject({ added: 0, stopped: 'key', left: 2 })
    expect(garminMessage(r1)).toContain('refused the key')
    const r2 = await syncGarmin({ api: fake([act(0), act(1)], { fileError: 'file' }).api, connId: 'c1', ...st })
    expect(r2).toMatchObject({ added: 0, errors: 2, stopped: null })
    const r3 = await syncGarmin({ api: async () => { throw Object.assign(new Error('x'), { code: 'dns' }) }, connId: 'c1', ...st })
    expect(r3.stopped).toBe('dns')
    expect(garminMessage(r3)).toBe('Could not reach Garmin')
  })

  it('says when there is nothing new', async () => {
    const st = store()
    expect(garminMessage(await syncGarmin({ api: fake([]).api, connId: 'c1', ...st }))).toBe('Nothing new on Garmin')
  })
})
