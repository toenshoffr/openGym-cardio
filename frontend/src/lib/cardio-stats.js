// The numbers behind Stats → Run and Stats → Ride (v1.5): all-time totals, a row per year, a
// month-by-month year, the last weeks, records, the pace (or speed) trend, and which days you
// trained at all, strength or cardio. Pure: everything reads S.workouts and S.cardio.
//
// A "session" here is a done cardio session (lib/cardio.js). Dates are the local day a session was
// done on (`date`), so a year is the calendar year in the profile's own time zone.
import { doneList, avgPace, avgSpeedKmh } from './cardio.js'
import { workoutDay } from './history.js'
import { isoOf } from './format.js'

const sum = (xs, f) => xs.reduce((n, x) => n + (f(x) || 0), 0)

/** Done sessions of one sport, oldest first. */
export const sportSessions = (S, sport) => doneList(S).filter(x => x.sport === sport).sort((a, b) => (a.start || 0) - (b.start || 0))

/** Totals of a list of sessions. avgPace is seconds per km, avgSpeed km/h, both from moving time. */
export function totals(list) {
  const distM = sum(list, x => x.distM), movingSec = sum(list, x => x.movingSec)
  const hrW = list.filter(x => x.avgHr > 0 && x.movingSec > 0)
  return {
    n: list.length, distM, movingSec,
    elevGain: sum(list, x => x.elevGain),
    avgPace: distM > 0 && movingSec > 0 ? movingSec / distM * 1000 : null,
    avgSpeed: distM > 0 && movingSec > 0 ? distM / movingSec * 3.6 : 0,
    avgHr: hrW.length ? Math.round(sum(hrW, x => x.avgHr * x.movingSec) / sum(hrW, x => x.movingSec)) : null,
    longest: list.reduce((best, x) => (!best || (x.distM || 0) > (best.distM || 0) ? x : best), null),
  }
}

/** Years with sessions, newest first, as numbers. */
export const yearsOf = list => [...new Set(list.map(x => Number(x.date.slice(0, 4))))].sort((a, b) => b - a)

/** One row per year with sessions, newest first: { year, ...totals }. */
export const byYear = list => yearsOf(list).map(year => ({ year, ...totals(list.filter(x => x.date.startsWith(year + '-'))) }))

/** The twelve months of `year`: [{ month: 0..11, n, distM, movingSec, elevGain }]. */
export function monthly(list, year) {
  return Array.from({ length: 12 }, (_, month) => {
    const key = year + '-' + String(month + 1).padStart(2, '0')
    const t = totals(list.filter(x => x.date.startsWith(key)))
    return { month, n: t.n, distM: t.distM, movingSec: t.movingSec, elevGain: t.elevGain }
  })
}

/**
 * The last `weeks` weeks ending with the one `todayIso` is in: [{ from (the week's first day), n, distM }],
 * oldest first. `ws` is the first weekday (0 Sunday, 1 Monday), the profile's.
 */
export function weekly(list, todayIso, weeks = 12, ws = 1) {
  const d = new Date(todayIso + 'T12:00:00')
  d.setDate(d.getDate() - ((d.getDay() - ws + 7) % 7))
  const out = []
  for (let i = weeks - 1; i >= 0; i--) {
    const a = new Date(d); a.setDate(a.getDate() - 7 * i)
    const b = new Date(a); b.setDate(b.getDate() + 7)
    const from = isoOf(a), to = isoOf(b)
    const inWeek = list.filter(x => x.date >= from && x.date < to)
    out.push({ from, n: inWeek.length, distM: sum(inWeek, x => x.distM) })
  }
  return out
}

/** Year to date against the year before at the same point (the same month and day): { cur, prev } totals. */
export function yearToDate(list, year, todayIso) {
  const md = todayIso.slice(5)
  const upTo = y => totals(list.filter(x => x.date.startsWith(y + '-') && x.date.slice(5) <= md))
  return { cur: upTo(year), prev: upTo(year - 1) }
}

// Under this a "fastest average" is a sprint to the corner, not a result. Metres.
export const MIN_FAST_M = { run: 3000, bike: 10000 }
export const BEST_KEYS = [1000, 5000, 10000, 21098, 42195]

/**
 * Records over a sport's sessions, each with the session it happened in (null when there is none):
 * longest, mostClimb, fastest (average, over MIN_FAST_M), and best[distance] = { sec, x }, the fastest
 * stretch of 1, 5, 10 km, a half and a full marathon found inside any session of at least that long.
 */
export function records(list, sport) {
  const top = (f, ok = () => true) => list.filter(ok).reduce((b, x) => (!b || f(x) > f(b) ? x : b), null)
  const best = {}
  for (const k of BEST_KEYS) {
    let at = null
    for (const x of list) { const e = x.best?.[k]; if (e && (!at || e.sec < at.sec)) at = { sec: e.sec, x } }
    if (at) best[k] = at
  }
  const fast = top(x => avgSpeedKmh(x), x => (x.distM || 0) >= (MIN_FAST_M[sport] || 3000) && x.movingSec > 0)
  return {
    longest: top(x => x.distM || 0), mostClimb: top(x => x.elevGain || 0, x => x.elevGain > 0), fastest: fast, best,
  }
}

/** Pace (run, seconds per km) or speed (ride, km/h) of each session, for a line chart: [{ t, y, d, id }]. */
export function trend(list, sport) {
  return list.filter(x => x.distM >= 1000 && x.movingSec > 0)
    .map(x => ({ t: x.start || Date.parse(x.date + 'T12:00:00'), y: sport === 'bike' ? avgSpeedKmh(x) : avgPace(x), d: x.date, id: x.id }))
}

/** The days in [from, to] (ISO, inclusive) that had a strength workout or a done cardio session. */
export function trainingDays(S, from, to) {
  const days = new Set()
  for (const w of S?.workouts || []) { const d = workoutDay(w); if (d && d >= from && d <= to) days.add(d) }
  for (const x of doneList(S)) if (x.date >= from && x.date <= to) days.add(x.date)
  return days
}

/** Cardio per day: { [iso]: { n, km, sec } } over done sessions, for the heatmap and the calendar. */
export function cardioByDay(S) {
  const out = {}
  for (const x of doneList(S)) {
    const a = out[x.date] ||= { n: 0, m: 0, sec: 0 }
    a.n++; a.m += x.distM || 0; a.sec += x.movingSec || 0
  }
  return out
}
