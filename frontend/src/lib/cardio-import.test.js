import { describe, it, expect } from 'vitest'
import { makeTrack, gpxOf, fitOf } from './cardio-fixtures.js'
import zlib from 'node:zlib'
import { importActivityFiles, DOC_LIMIT } from './cardio-import.js'
import { addPlanned, cardioList, dayOf } from './cardio.js'

// A copy with a buffer of its own: a small Node Buffer sits in a shared pool, and its .buffer is all of it.
const file = (name, data) => ({ name, arrayBuffer: async () => new Uint8Array(typeof data === 'string' ? new TextEncoder().encode(data) : data).buffer })
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

describe('zip archives', () => {
  const crc = (() => { const t = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 }); return b => { let c = ~0; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0 } })()
  /** A zip of [name, bytes] entries, deflated (or stored). */
  const zipOf = (entries, { store = false } = {}) => {
    const parts = [], central = []; let off = 0
    for (const [name, data] of entries) {
      const raw = Buffer.from(data), body = store ? raw : zlib.deflateRawSync(raw), nm = Buffer.from(name)
      const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(store ? 0 : 8, 8); lh.writeUInt32LE(crc(raw), 14)
      lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26)
      const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(store ? 0 : 8, 10); ch.writeUInt32LE(crc(raw), 16)
      ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42)
      parts.push(lh, nm, body); central.push(ch, nm); off += 30 + nm.length + body.length
    }
    const cd = Buffer.concat(central), end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16)
    return Buffer.concat([...parts, cd, end])
  }
  const gz = d => zlib.gzipSync(Buffer.from(d))

  it('imports every activity file in a zip, whatever the format, and skips the rest', async () => {
    const st = store()
    const zip = zipOf([
      ['activities/1.gpx', gpxOf(makeTrack({ legs: [[3000, 300]], t0: T }))],
      ['activities/2.fit.gz', gz(fitOf(makeTrack({ legs: [[4000, 300]], t0: T + 86400000 }), { sport: 1 }))],
      ['activities.csv', 'id,name\n1,Run'], ['media/photo.jpg', 'not an activity'], ['__MACOSX/._1.gpx', 'junk'],
    ])
    const r = await importActivityFiles([file('archive.zip', zip)], st.get, st.update)
    expect(r.map(x => [x.name, x.status])).toEqual([['archive.zip/activities/1.gpx', 'added'], ['archive.zip/activities/2.fit.gz', 'added']])
    expect(cardioList(st.S)).toHaveLength(2)
  })

  it('reads a stored zip too, and a zip made by Garmin\'s one-file export', async () => {
    const st = store()
    const r = await importActivityFiles([file('12345_ACTIVITY.zip', zipOf([['12345_ACTIVITY.fit', fitOf(makeTrack({ legs: [[2000, 300]], t0: T }), { sport: 1 })]], { store: true }))], st.get, st.update)
    expect(r[0]).toMatchObject({ status: 'added' })
  })

  it('a zip with no activity in it, and one that is not a zip, say so', async () => {
    const st = store()
    const r = await importActivityFiles([file('nothing.zip', zipOf([['readme.txt', 'hi']])), file('broken.zip', Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(40)]))], st.get, st.update)
    expect(r[0]).toMatchObject({ status: 'error', code: 'nozip' })
    expect(r[1]).toMatchObject({ status: 'error', code: 'format' })
  })

  it('an archive with one bad file and one repeated file still brings in the rest', async () => {
    const st = store()
    const good = gpxOf(makeTrack({ legs: [[3000, 300]], t0: T }))
    const r = await importActivityFiles([file('a.zip', zipOf([['1.gpx', good], ['2.gpx', 'not xml at all'], ['3.gpx', good]]))], st.get, st.update)
    expect(r.map(x => x.status)).toEqual(['added', 'error', 'duplicate'])
  })

  it('a zip that claims to be small and is not is refused, not unpacked into memory', async () => {
    const st = store()
    const z = zipOf([['bomb.gpx', Buffer.alloc(120 * 1024 * 1024, 65)]])
    // the central directory is made to lie about the size
    z.writeUInt32LE(1000, z.indexOf(Buffer.from([0x50, 0x4b, 1, 2])) + 24)
    const r = await importActivityFiles([file('bomb.zip', z)], st.get, st.update)
    expect(r[0]).toMatchObject({ status: 'error', code: 'format' })
  }, 30000)
})

describe('room in the profile', () => {
  it('stops before the document passes the limit, and every file left says full without being read', async () => {
    const st = store()
    st.S.padding = 'x'.repeat(DOC_LIMIT - 3000)            // a profile that is nearly full already
    const files = [1, 2, 3, 4].map(i => file(`r${i}.gpx`, gpxOf(makeTrack({ legs: [[3000 + i * 100, 300]], t0: T + i * 86400000 }))))
    const r = await importActivityFiles(files, st.get, st.update)
    expect(r.filter(x => x.status === 'added').length).toBeGreaterThan(0)
    expect(r.filter(x => x.status === 'added').length).toBeLessThan(4)
    expect(r.filter(x => x.code === 'full').length).toBe(4 - r.filter(x => x.status === 'added').length)
    expect(JSON.stringify(st.S).length).toBeLessThan(DOC_LIMIT + 8000)
  })

  it('an ordinary profile is never held up', async () => {
    const st = store()
    const files = [1, 2, 3].map(i => file(`r${i}.gpx`, gpxOf(makeTrack({ legs: [[2000 + i * 100, 300]], t0: T + i * 86400000 }))))
    expect((await importActivityFiles(files, st.get, st.update)).map(x => x.status)).toEqual(['added', 'added', 'added'])
  })
})
