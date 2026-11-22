// What a finished run or ride says, in a handful of plain observations (v1.5, Cardio).
//
// insightsOf(session, all) returns [{ id, ...params }] in the order worth reading. The screen
// words each id through t() with its params, so a new insight is a new id here plus its sentence
// there. Nothing is invented: an insight shows only when the file carries the data and the
// effect is large enough to mean something.
import { doneList, weekStart, weekTotals } from './cardio.js'
import { isoOf, weekStartOf } from './format.js'

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length
const sd = xs => { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))) }
const full = x => (x.splits || []).filter(s => s.full && s.pace > 0)

/** The best effort distances (m) a PR can be for, longest first. */
const PR_DISTANCES = [10000, 5000, 1000]

export function insightsOf(x, S) {
  const out = []
  const sp = full(x)
  const others = doneList(S).filter(o => o.id !== x.id && o.sport === x.sport && (o.start || 0) < (x.start || Infinity))

  // New personal bests: the first of these distances where this session beat every earlier one.
  for (const d of PR_DISTANCES) {
    const mine = x.best?.[d]
    if (!mine) continue
    const prev = others.map(o => o.best?.[d]?.sec).filter(Boolean)
    if (prev.length && mine.sec < Math.min(...prev)) {
      out.push({ id: 'pr', distM: d, sec: mine.sec, prevSec: Math.min(...prev) })
      break
    }
  }

  // Pacing: the first half of the full kilometres against the second.
  if (sp.length >= 4) {
    const h = Math.floor(sp.length / 2)
    const first = mean(sp.slice(0, h).map(s => s.pace)), second = mean(sp.slice(sp.length - h).map(s => s.pace))
    const pct = (second - first) / first * 100
    if (pct <= -1.5) out.push({ id: 'negative', pct: Math.round(-pct * 10) / 10 })
    else if (pct >= 4) out.push({ id: 'fade', pct: Math.round(pct * 10) / 10 })
    else if (sd(sp.map(s => s.pace)) / mean(sp.map(s => s.pace)) < 0.03) out.push({ id: 'even' })
  }

  // The fastest and the slowest kilometre, when they differ enough to be a story.
  if (sp.length >= 3) {
    const fast = sp.reduce((a, b) => (b.pace < a.pace ? b : a)), slow = sp.reduce((a, b) => (b.pace > a.pace ? b : a))
    if (slow.pace - fast.pace >= 10) out.push({ id: 'range', fastKm: fast.km, fastPace: fast.pace, slowKm: slow.km, slowPace: slow.pace })
  }

  // Heart rate drift: at a steady pace, a heart rate that climbs through the session.
  if (sp.length >= 4 && sp.every(s => s.hr != null)) {
    const h = Math.floor(sp.length / 2)
    const p1 = mean(sp.slice(0, h).map(s => s.pace)), p2 = mean(sp.slice(sp.length - h).map(s => s.pace))
    const h1 = mean(sp.slice(0, h).map(s => s.hr)), h2 = mean(sp.slice(sp.length - h).map(s => s.hr))
    const drift = (h2 - h1) / h1 * 100
    if (Math.abs(p2 - p1) / p1 < 0.03 && drift >= 5) out.push({ id: 'drift', pct: Math.round(drift * 10) / 10 })
  }

  // Terrain: a lot of climb for the distance.
  if (x.distM >= 3000 && x.elevGain / (x.distM / 1000) >= 15) {
    out.push({ id: 'hilly', gain: x.elevGain, perKm: Math.round(x.elevGain / (x.distM / 1000)) })
  }

  // Against the plan, when the session was planned.
  if (x.plan?.distM && x.distM) {
    const pct = Math.round((x.distM - x.plan.distM) / x.plan.distM * 100)
    if (Math.abs(pct) >= 5) out.push({ id: 'plan', pct, planM: x.plan.distM, distM: x.distM })
    else out.push({ id: 'plan-met', planM: x.plan.distM })
  }

  // The longest one so far.
  if (others.length >= 2 && x.distM > Math.max(...others.map(o => o.distM || 0))) out.push({ id: 'longest', distM: x.distM })

  // The week it sits in against the four before it.
  if (x.date) {
    const ws = weekStartOf(S)
    const wk = weekStart(x.date, ws)
    const here = weekTotals(S, wk).distM
    const prior = [1, 2, 3, 4].map(i => {
      const d = new Date(wk + 'T12:00:00'); d.setDate(d.getDate() - 7 * i)
      return weekTotals(S, weekStart(isoOf(d), ws)).distM
    }).filter(v => v > 0)
    if (prior.length >= 2 && here > 0) {
      const avg = mean(prior), pct = Math.round((here - avg) / avg * 100)
      if (Math.abs(pct) >= 20) out.push({ id: 'week', pct, km: Math.round(here / 100) / 10 })
    }
  }
  return out
}
