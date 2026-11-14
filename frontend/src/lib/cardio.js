// Cardio (v1.5): runs and rides, planned for a day and filled in from a Strava or Garmin file.
//
// `S.cardio` is a map { [id]: session }, merged per key like `programmes` (lib/sync-merge.js), so a
// run imported on the phone and a ride planned on the laptop both survive. A session is one of:
//
//   planned: { id, sport, date, status: 'planned', title?, plan: { distM?, sec?, note? } }
//   done:    the same with status 'done' and everything analyze() reads from the file
//            (start, distM, movingSec, elapsedSec, elevGain, splits, laps, best, pts, ...),
//            plus `plan` kept from the planned session it was matched to, if there was one.
//
// The Plan screen's weekly rhythm is `S.cardioWeek`, { [id]: slot } with a slot { id, wd (0 = Sunday),
// sport, title, plan, from (the day it was added) }, merged per slot too. A slot is not a pile of
// sessions made ahead: it shows on every matching weekday from `from` on as a virtual planned
// session (id `slot:<slot>:<day>`, planFor / planOf) and only becomes a real one on the day it
// is imported, edited for that day, or skipped. A real session that came from a slot carries
// `slot`; deleting it leaves a bare { status: 'skipped' } marker so the slot does not show again
// on that day.
//
// Importing never invents a session out of a file already imported (same start time and sport),
// and fills a planned one when it can (suggestMatch). Everything here is pure; the screen calls
// useStore.update with these.
import { isoOf, uid } from './format.js'

export const SPORTS = ['run', 'bike']
export const sportOr = s => (SPORTS.includes(s) ? s : 'run')
/** A file that does not name its sport: faster than 16 km/h on average is a ride. */
export const guessSport = a => (a.distM > 0 && a.movingSec > 0 && a.distM / a.movingSec * 3.6 > 16 ? 'bike' : 'run')

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)

/** Every session, newest date first (a day's sessions by start time, planned ones last). */
export function cardioList(S) {
  const m = isMap(S?.cardio) ? S.cardio : {}
  return Object.values(m).filter(x => isMap(x) && x.id && x.date && x.status !== 'skipped')
    .sort((a, b) => b.date.localeCompare(a.date) || (Number(b.start) || 0) - (Number(a.start) || 0))
}
export const doneList = S => cardioList(S).filter(x => x.status === 'done')

/** The local calendar day a time falls on, as YYYY-MM-DD. */
export const dayOf = ms => isoOf(new Date(ms))

/** Adds a planned session. `plan` fields are optional; a distance is in metres, a time in seconds. */
export function addPlanned(s, { sport, date, title = '', distM = null, sec = null, note = '' }, now = Date.now()) {
  if (!isMap(s.cardio)) s.cardio = {}
  const id = 'c' + uid()
  const plan = {}
  if (distM > 0) plan.distM = Math.round(distM)
  if (sec > 0) plan.sec = Math.round(sec)
  if (note) plan.note = String(note).slice(0, 500)
  s.cardio[id] = { id, sport: sportOr(sport), date, status: 'planned', title: String(title).slice(0, 80), plan, _ts: now }
  return id
}

/** Changes a planned session's own fields (sport, date, title, plan). A done one keeps its data. */
export function editSession(s, id, patch, now = Date.now()) {
  const x = s.cardio?.[id]
  if (!x) return false
  if (patch.sport) x.sport = sportOr(patch.sport)
  if (patch.date) x.date = patch.date
  if (patch.title != null) x.title = String(patch.title).slice(0, 80)
  if (patch.plan) {
    const plan = { ...(x.plan || {}) }
    for (const k of ['distM', 'sec']) if (k in patch.plan) { if (patch.plan[k] > 0) plan[k] = Math.round(patch.plan[k]); else delete plan[k] }
    if ('note' in patch.plan) { if (patch.plan.note) plan.note = String(patch.plan.note).slice(0, 500); else delete plan.note }
    x.plan = plan
  }
  x._ts = now
  return true
}

/** Removes a session. One that came from a weekly slot (or is a slot's virtual day) leaves a marker, so the slot does not show on that day again. */
export function removeSession(s, id) {
  const v = parseVirtual(id)
  if (v) {
    if (!isMap(s.cardio)) s.cardio = {}
    const mid = 'c' + uid()
    s.cardio[mid] = { id: mid, slot: v.slot, date: v.date, status: 'skipped', _ts: Date.now() }
    return true
  }
  const x = s.cardio?.[id]
  if (!x) return false
  if (x.slot) s.cardio[id] = { id, slot: x.slot, date: x.date, status: 'skipped', _ts: Date.now() }
  else delete s.cardio[id]
  return true
}

/* ------------------------------------------------------------- the weekly plan -- */

export const slotList = S => (isMap(S?.cardioWeek) ? Object.values(S.cardioWeek) : []).filter(x => isMap(x) && x.id && x.wd >= 0 && x.wd <= 6)
/** The slots of one weekday (0 = Sunday), in the order added. */
export const slotsOnWeekday = (S, wd) => slotList(S).filter(x => x.wd === wd).sort((a, b) => (a._ts || 0) - (b._ts || 0))

/** Adds a slot: the same run or ride every `wd`, from today (or `from`) on. Returns its id. */
export function addSlot(s, { wd, sport, title = '', distM = null, sec = null, note = '', from = null }, now = Date.now()) {
  if (!isMap(s.cardioWeek)) s.cardioWeek = {}
  const id = 's' + uid()
  const plan = {}
  if (distM > 0) plan.distM = Math.round(distM)
  if (sec > 0) plan.sec = Math.round(sec)
  if (note) plan.note = String(note).slice(0, 500)
  s.cardioWeek[id] = { id, wd: ((wd % 7) + 7) % 7, sport: sportOr(sport), title: String(title).slice(0, 80), plan, from: from || isoOf(new Date(now)), _ts: now }
  return id
}
export function editSlot(s, id, patch, now = Date.now()) {
  const x = s.cardioWeek?.[id]
  if (!x) return false
  if (patch.sport) x.sport = sportOr(patch.sport)
  if (patch.title != null) x.title = String(patch.title).slice(0, 80)
  if (patch.plan) {
    const plan = { ...(x.plan || {}) }
    for (const k of ['distM', 'sec']) if (k in patch.plan) { if (patch.plan[k] > 0) plan[k] = Math.round(patch.plan[k]); else delete plan[k] }
    if ('note' in patch.plan) { if (patch.plan.note) plan.note = String(patch.plan.note).slice(0, 500); else delete plan.note }
    x.plan = plan
  }
  x._ts = now
  return true
}
/** Takes a slot out of the weekly plan. Days already done or edited keep their sessions. */
export function removeSlot(s, id) {
  if (s.cardioWeek && id in s.cardioWeek) { delete s.cardioWeek[id]; return true }
  return false
}

export const virtualId = (slot, iso) => `slot:${slot}:${iso}`
export function parseVirtual(id) {
  const m = /^slot:([^:]+):(\d{4}-\d{2}-\d{2})$/.exec(String(id || ''))
  return m ? { slot: m[1], date: m[2] } : null
}
const covered = (S, slotId, iso) => Object.values(isMap(S?.cardio) ? S.cardio : {}).some(x => isMap(x) && x.slot === slotId && x.date === iso)
const virtualOf = (slot, iso) => ({ id: virtualId(slot.id, iso), virtual: true, slot: slot.id, sport: slot.sport, date: iso, status: 'planned', title: slot.title || '', plan: slot.plan || {} })

/**
 * Everything planned or done on a day: the real sessions, planned first, then the weekly slots of
 * that weekday that nothing on that day has taken over yet, as virtual planned sessions.
 */
export function planFor(S, iso) {
  const real = cardioList(S).filter(x => x.date === iso).sort((a, b) => (a.status === 'planned' ? 0 : 1) - (b.status === 'planned' ? 0 : 1))
  const wd = new Date(iso + 'T12:00:00').getDay()
  const virtual = slotsOnWeekday(S, wd).filter(x => iso >= (x.from || '') && !covered(S, x.id, iso)).map(x => virtualOf(x, iso))
  const planned = [...real.filter(x => x.status === 'planned'), ...virtual], done = real.filter(x => x.status === 'done')
  return [...planned, ...done]
}
export const cardioOnDay = planFor

/** A session by id, real or a slot's virtual day; null when it is neither (or was skipped). */
export function planOf(S, id) {
  const v = parseVirtual(id)
  if (!v) { const x = S?.cardio?.[id]; return x && x.status !== 'skipped' ? x : null }
  const slot = S?.cardioWeek?.[v.slot]
  if (!slot || new Date(v.date + 'T12:00:00').getDay() !== slot.wd || covered(S, v.slot, v.date)) return null
  return virtualOf(slot, v.date)
}

/** Makes a virtual day a real planned session (a real id comes back unchanged). Returns the id. */
export function materialize(s, id, now = Date.now()) {
  const v = parseVirtual(id)
  if (!v) return id
  const x = planOf(s, id)
  if (!x) return null
  if (!isMap(s.cardio)) s.cardio = {}
  const mid = 'c' + uid()
  s.cardio[mid] = { id: mid, slot: x.slot, sport: x.sport, date: x.date, status: 'planned', title: x.title, plan: { ...x.plan }, _ts: now }
  return mid
}

/** The planned sessions to show from `from` for `days` days: real ones of any date (an open one
 *  from the past included) and the slots' days in that window, oldest first. */
export function upcoming(S, from, days = 14) {
  const out = cardioList(S).filter(x => x.status === 'planned')
  const end = new Date(from + 'T12:00:00'); end.setDate(end.getDate() + days)
  for (let d = new Date(from + 'T12:00:00'); d < end; d.setDate(d.getDate() + 1)) {
    const iso = isoOf(d)
    out.push(...planFor(S, iso).filter(x => x.virtual))
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/** Whether a session with this file's start time (± a minute) and sport is already stored. */
export function findDuplicate(S, a) {
  return doneList(S).find(x => Math.abs((Number(x.start) || 0) - a.start) < 60000 && (!x.sport || !a.sport || x.sport === a.sport)) || null
}

const dayDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 864e5)

/**
 * The planned session an imported activity most likely fulfils: the same sport (a file with no
 * sport matches either), planned for the same day or one day either side, closest day first,
 * then the closest planned distance. Null when nothing fits.
 */
export function suggestMatch(S, a) {
  const day = dayOf(a.start)
  const cands = []
  for (const k of [-1, 0, 1]) {
    const d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() + k)
    cands.push(...planFor(S, isoOf(d)).filter(x => x.status === 'planned' && (!a.sport || x.sport === a.sport)))
  }
  if (!cands.length) return null
  const gap = x => x.plan?.distM ? Math.abs(x.plan.distM - a.distM) : Infinity
  cands.sort((p, q) => Math.abs(dayDiff(p.date, day)) - Math.abs(dayDiff(q.date, day)) || gap(p) - gap(q))
  return cands[0]
}

/**
 * Stores an analysed activity (analyze()) as a done session. With `matchId` it fills that planned
 * session in place (keeping its plan), otherwise it becomes a new one. The sport the file does not
 * name comes from the planned session, or `sport`. Returns the session id.
 */
export function addDone(s, a, { matchId = null, sport = null, title = '' } = {}, now = Date.now()) {
  if (!isMap(s.cardio)) s.cardio = {}
  // A weekly slot's day becomes a real session first, so there is something to fill in place.
  const realId = matchId && planOf(s, matchId)?.status === 'planned' ? materialize(s, matchId, now) : null
  const planned = realId ? s.cardio[realId] : null
  const id = planned ? planned.id : 'c' + uid()
  const sp = sportOr(a.sport || planned?.sport || sport || guessSport(a))
  const day = dayOf(a.start)
  const { name, ...rest } = a
  s.cardio[id] = {
    ...rest, id, sport: sp, date: day, status: 'done',
    title: String(title || planned?.title || name || '').slice(0, 80),
    ...(planned?.plan && Object.keys(planned.plan).length ? { plan: planned.plan } : {}),
    ...(planned?.slot ? { slot: planned.slot } : {}),
    _ts: now,
  }
  return id
}

/* ------------------------------------------------------------------ the numbers -- */

/** Seconds per kilometre → "5:12". Null and absurd values give "–". */
export function fmtPace(secPerKm) {
  if (!(secPerKm > 0) || secPerKm > 3600) return '–'
  let m = Math.floor(secPerKm / 60), s = Math.round(secPerKm - m * 60)
  if (s === 60) { m += 1; s = 0 }
  return m + ':' + String(s).padStart(2, '0')
}
/** Seconds → "42:07" or "1:02:07". */
export function fmtClock(sec) {
  if (!(sec >= 0)) return '–'
  const t = Math.round(sec), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}
/** Metres → "10.42" kilometres: two decimals at most, none from 100 km up. */
export function fmtKm(m) {
  if (!(m >= 0)) return '–'
  const km = m / 1000
  return km >= 100 ? String(Math.round(km)) : String(Math.round(km * 100) / 100)
}
/** Metres per second → km/h with a decimal. */
export const kmh = ms => (ms > 0 ? Math.round(ms * 36) / 10 : 0)

export const avgPace = x => (x.distM > 0 && x.movingSec > 0 ? x.movingSec / x.distM * 1000 : null)
export const avgSpeedKmh = x => (x.distM > 0 && x.movingSec > 0 ? x.distM / x.movingSec * 3.6 : 0)

/**
 * The figure a session's speed is shown as: min/km for a run, km/h for a ride. `value` is the
 * number, `unit` the English key the screen translates ('/km', 'km/h').
 */
export function speedLabel(sport, secPerKm) {
  if (!(secPerKm > 0)) return { value: '–', unit: sport === 'bike' ? 'km/h' : '/km' }
  return sport === 'bike'
    ? { value: (Math.round(3600 / secPerKm * 10) / 10).toString(), unit: 'km/h' }
    : { value: fmtPace(secPerKm), unit: '/km' }
}

/** Monday-based week start of an ISO day (the Cardio week is the plain calendar week). */
export function weekStart(iso, ws = 1) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() - ((d.getDay() - ws + 7) % 7))
  return isoOf(d)
}

/** Totals for the week starting `from` (done sessions only): count, distance, moving time, climb. */
export function weekTotals(S, from) {
  const end = new Date(from + 'T12:00:00'); end.setDate(end.getDate() + 7)
  const to = isoOf(end)
  const xs = doneList(S).filter(x => x.date >= from && x.date < to)
  return {
    count: xs.length,
    distM: xs.reduce((n, x) => n + (x.distM || 0), 0),
    movingSec: xs.reduce((n, x) => n + (x.movingSec || 0), 0),
    elevGain: xs.reduce((n, x) => n + (x.elevGain || 0), 0),
  }
}
