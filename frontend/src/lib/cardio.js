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
  return Object.values(m).filter(x => isMap(x) && x.id && x.date)
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

export function removeSession(s, id) {
  if (s.cardio && id in s.cardio) { delete s.cardio[id]; return true }
  return false
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
  const cands = cardioList(S).filter(x => x.status === 'planned' && (!a.sport || x.sport === a.sport) && Math.abs(dayDiff(x.date, day)) <= 1)
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
  const planned = matchId && s.cardio[matchId]?.status === 'planned' ? s.cardio[matchId] : null
  const id = planned ? planned.id : 'c' + uid()
  const sp = sportOr(a.sport || planned?.sport || sport || guessSport(a))
  const day = dayOf(a.start)
  const { name, ...rest } = a
  s.cardio[id] = {
    ...rest, id, sport: sp, date: day, status: 'done',
    title: String(title || planned?.title || name || '').slice(0, 80),
    ...(planned?.plan && Object.keys(planned.plan).length ? { plan: planned.plan } : {}),
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
