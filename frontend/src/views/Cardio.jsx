// Cardio (v1.5): runs and rides. Plan one for a day, then fill it in from the file your watch or
// Strava gives you (GPX, TCX or FIT): route, laps, a pace for every kilometre, and what it all says.
// The logic is in lib/cardio*.js; this is only the screens. Nothing leaves the device: the route is
// drawn here from the file's own coordinates, with no map tiles fetched from anywhere.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import Icon from '../components/Icon.jsx'
import { cardioPlanSheet, openPlanned } from '../components/CardioPlanSheet.jsx'
import { Button } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'
import { fmtDate, fmtNum, todayISO, isoOf } from '../lib/format.js'
import { t, tn } from '../lib/i18n.js'
import {
  removeSession, cardioList, planOf, upcoming, avgPace, speedLabel, fmtClock, fmtKm,
  weekStart, weekTotals,
} from '../lib/cardio.js'
import { importActivityFiles } from '../lib/cardio-import.js'
import { syncGarmin, garminMessage } from '../lib/garmin-sync.js'
import { api } from '../lib/api.js'
import { DEMO } from '../lib/demo.js'
import { insightsOf } from '../lib/cardio-insights.js'
import './Cardio.css'

const update = fn => useStore.getState().update(fn)
const toast = m => useUI.getState().toast(m)
const ICON = { run: 'figureRun', bike: 'bike' }
const sportName = sp => (sp === 'bike' ? t('Ride') : t('Run'))
const unitText = u => (u === 'km/h' ? t('km/h') : t('/km'))
/** "5:12/km" for a run, "27.4 km/h" for a ride. */
const withUnit = v => v.value + (v.unit === 'km/h' ? ' ' : '') + unitText(v.unit)
const timeOfDay = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const titleOf = x => x.title || sportName(x.sport)

/** What a planned session asks for, as one line: "10 km · 1:00:00". Empty when it asks for nothing. */
function planLine(x) {
  const bits = []
  if (x.plan?.distM) bits.push(fmtKm(x.plan.distM) + ' ' + t('km'))
  if (x.plan?.sec) bits.push(fmtClock(x.plan.sec))
  return bits.join(' · ')
}

/* ------------------------------------------------------------------- importing -- */

/** Words for a CardioError's code (lib/cardio-error.js), or 'read'. */
function errorText(code) {
  switch (code) {
    case 'empty': return t('That file has no track in it')
    case 'zip': return t('That is a zip file. Unpack it first and pick the activity files inside')
    case 'gz': return t('This browser cannot unpack .gz files. Unpack it first')
    case 'nodistance': return t('That file has no distance in it')
    case 'read': return t('Could not read that file')
    default: return t('That is not a GPX, TCX or FIT file')
  }
}

/** Words for a batch of results, as one toast. */
export function importMessage(results) {
  const added = results.filter(r => r.status === 'added'), dup = results.filter(r => r.status === 'duplicate'), bad = results.filter(r => r.status === 'error')
  if (results.length === 1) {
    if (added.length) return added[0].planned ? t('Imported and matched to your plan') : t('Imported')
    if (dup.length) return t('Already imported')
    return errorText(bad[0].code)
  }
  return t('{0} imported, {1} already there, {2} could not be read', added.length, dup.length, bad.length)
}

async function runImport(fileList, matchId) {
  const files = [...fileList]
  if (!files.length) return null
  const results = await importActivityFiles(files, () => useStore.getState().S, update, { matchId })
  toast(importMessage(results))
  return results
}

/* ------------------------------------------------------------------ the list -- */

function WeekCard({ S }) {
  const today = todayISO()
  const start = weekStart(today)
  const weeks = useMemo(() => Array.from({ length: 8 }, (_, i) => {
    const d = new Date(start + 'T12:00:00'); d.setDate(d.getDate() - 7 * (7 - i))
    const from = isoOf(d)
    return { from, ...weekTotals(S, from) }
  }), [S, start])
  const now = weeks[7]
  const top = Math.max(1, ...weeks.map(w => w.distM))
  return <div className="card cardio-week">
    <div className="muted small">{t('This week')}</div>
    <div className="row between" style={{ alignItems: 'flex-end' }}>
      <div className="big">{fmtKm(now.distM)} <span className="muted" style={{ fontSize: 'var(--fs-callout)' }}>{t('km')}</span></div>
      <div className="small dim" style={{ textAlign: 'end' }}>
        {tn('{0} session', '{0} sessions', now.count)}<br />{now.movingSec ? fmtClock(now.movingSec) : '–'}
      </div>
    </div>
    <div className="cardio-bars" aria-hidden="true">
      {weeks.map((w, i) => <div key={w.from} className={'cardio-bar' + (i === 7 ? ' now' : '')}
        style={{ height: Math.max(3, Math.round(w.distM / top * 100)) + '%' }} />)}
    </div>
    <div className="small dim">{t('Distance per week, last 8 weeks')}</div>
  </div>
}

function SessionRow({ x, onOpen, children }) {
  const done = x.status === 'done'
  const sp = done ? speedLabel(x.sport, avgPace(x)) : null
  return <div className="card cardio-row" onClick={onOpen} role="button" tabIndex={0}
    onKeyDown={e => { if (e.key === 'Enter') onOpen() }}>
    <div className="cardio-ico" data-sport={x.sport}><Icon name={ICON[x.sport] || 'figureRun'} /></div>
    <div className="grow" style={{ minWidth: 0 }}>
      <div className="row between">
        <b className="cardio-title">{titleOf(x)}</b>
        <span className="small dim">{fmtDate(x.date)}</span>
      </div>
      {done
        ? <div className="small dim" style={{ marginTop: 2 }}>
          {fmtKm(x.distM)} {t('km')} · {fmtClock(x.movingSec)} · {withUnit(sp)}
        </div>
        : <div className="small dim" style={{ marginTop: 2 }}>{planLine(x) || t('Planned')}{x.plan?.note ? ' · ' + x.plan.note : ''}</div>}
    </div>
    {children}
  </div>
}

/** The Garmin connection of this profile (Settings → Integrations → Garmin Connect), or null. */
function useGarmin() {
  const user = useStore(s => s.user)
  const offered = useStore(s => s.config?.integrations?.providers) || []
  const on = !!user && !DEMO && offered.includes('garmin')
  const [conn, setConn] = useState(null)
  useEffect(() => {
    if (!on) return undefined
    let gone = false
    api('/api/integrations').then(d => { if (!gone) setConn((d?.connections || []).find(c => c.provider === 'garmin' && !c.paused) || null) }).catch(() => {})
    return () => { gone = true }
  }, [on])
  return conn
}

export default function Cardio() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const garmin = useGarmin()
  const [syncing, setSyncing] = useState(null)
  const fileRef = useRef(null)
  const matchRef = useRef(null)
  const today = todayISO()
  const all = cardioList(S)
  // Planned: one-offs of any day and the weekly slots' days of the next two weeks (lib/cardio.js).
  const planned = upcoming(S, today, 14)
  const done = all.filter(x => x.status === 'done')
  const pick = matchId => { matchRef.current = matchId; fileRef.current?.click() }
  const onFiles = async ev => {
    const files = [...ev.target.files]
    ev.target.value = ''
    const matchId = matchRef.current
    matchRef.current = null
    const r = await runImport(files, matchId)
    if (r?.length === 1 && r[0].status === 'added') nav('/cardio/' + r[0].id)
  }
  const syncFromGarmin = async () => {
    if (!garmin || syncing) return
    setSyncing({ done: 0, total: 0 })
    try {
      const r = await syncGarmin({
        api, connId: garmin.id, getS: () => useStore.getState().S, update,
        onProgress: (done, total) => setSyncing({ done, total }),
      })
      toast(garminMessage(r))
    } finally { setSyncing(null) }
  }
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" data-back="/stats" onClick={() => nav('/stats')} aria-label={t('Stats')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{t('Cardio')}</h1><div className="sub">{t('Runs and rides')}</div></div>
      <button className="iconbtn" onClick={() => cardioPlanSheet(null, today)} aria-label={t('Plan a session')}><Icon name="plus" /></button>
    </div>
    {/* No accept filter: iOS greys out .fit files it does not know, and the content decides anyway. */}
    <input ref={fileRef} type="file" multiple hidden onChange={onFiles} />

    <WeekCard S={S} />
    {garmin && <><Button icon="watch" variant="primary" disabled={!!syncing} onClick={syncFromGarmin}>
      {syncing?.total ? t('Getting {0} of {1}…', Math.min(syncing.done + 1, syncing.total), syncing.total) : syncing ? t('Working…') : t('Sync from Garmin')}
    </Button><div style={{ height: 8 }} /></>}
    <Button icon="download" variant={garmin ? 'tinted' : 'primary'} onClick={() => pick(null)}>{t('Import from Strava or Garmin')}</Button>
    <div className="small dim" style={{ margin: '8px 2px 0' }}>{t('Pick the GPX, TCX or FIT file of an activity. How to get one is in the docs.')}</div>

    <div className="row between" style={{ margin: '20px 2px 10px' }}>
      <h4 className="sec" style={{ margin: 0 }}>{t('Planned')}</h4>
      <Button size="sm" variant="ghost" icon="plus" onClick={() => cardioPlanSheet(null, today)}>{t('Plan')}</Button>
    </div>
    {planned.length ? <div className="list">{planned.map(x => <SessionRow key={x.id} x={x} onOpen={() => openPlanned(x)}>
      <div className="cardio-act" onClick={e => e.stopPropagation()}>
        {x.date < today && <span className="tag">{t('Open')}</span>}
        <Button size="sm" icon="download" onClick={() => pick(x.id)} aria-label={t('Import into this session')}>{t('Import')}</Button>
      </div>
    </SessionRow>)}</div> : <div className="empty small">{t('Nothing planned. Plan a run or a ride for a day, then import it here once you have done it.')}</div>}

    <h4 className="sec" style={{ margin: '20px 2px 10px' }}>{t('Done')}</h4>
    {done.length ? <div className="list">{done.map(x => <SessionRow key={x.id} x={x} onOpen={() => nav('/cardio/' + x.id)} />)}</div>
      : <div className="empty small">{t('No activities yet')}</div>}
  </div>
}

/* ------------------------------------------------------------------ the detail -- */

function Stat({ label, value, unit }) {
  return <div className="cardio-stat"><div className="muted small">{label}</div>
    <div className="cardio-stat-v">{value}{unit && <span className="muted small"> {unit}</span>}</div></div>
}

const mix = f => `hsl(${Math.round(30 + 110 * f)} 85% 55%)`

/** The route, drawn from the file's own coordinates (no tiles), the colour showing how fast it was. */
function RouteMap({ pts }) {
  const g = pts.filter(p => p[0] != null && p[1] != null)
  if (g.length < 2) return null
  const lat0 = g.reduce((s, p) => s + p[0], 0) / g.length / 1e5
  const k = Math.cos(lat0 * Math.PI / 180)
  const xy = g.map(p => [p[1] / 1e5 * k, -p[0] / 1e5, p[4]])
  const xs = xy.map(p => p[0]), ys = xy.map(p => p[1])
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  const W = 340, H = 220, pad = 18
  const sc = Math.min((W - 2 * pad) / Math.max(1e-9, x1 - x0), (H - 2 * pad) / Math.max(1e-9, y1 - y0))
  const ox = (W - (x1 - x0) * sc) / 2, oy = (H - (y1 - y0) * sc) / 2
  const P = p => [ox + (p[0] - x0) * sc, oy + (p[1] - y0) * sc]
  const sp = xy.map(p => p[2]).filter(v => v > 0).sort((a, b) => a - b)
  const lo = sp[Math.floor(sp.length * 0.1)] ?? 0, hi = sp[Math.floor(sp.length * 0.9)] ?? 1
  const col = v => mix(hi > lo ? Math.min(1, Math.max(0, (v - lo) / (hi - lo))) : 0.5)
  const a = P(xy[0]), z = P(xy[xy.length - 1])
  return <svg className="cardio-map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('Route')}>
    {xy.slice(1).map((p, i) => {
      const u = P(xy[i]), v = P(p)
      return <line key={i} x1={u[0]} y1={u[1]} x2={v[0]} y2={v[1]} stroke={col(p[2])} strokeWidth="3.5" strokeLinecap="round" />
    })}
    <circle cx={a[0]} cy={a[1]} r="5.5" fill="var(--green)" stroke="var(--bg)" strokeWidth="2" />
    <circle cx={z[0]} cy={z[1]} r="5.5" fill="var(--red)" stroke="var(--bg)" strokeWidth="2" />
  </svg>
}

/** Pace (or speed) along the distance, over a soft elevation profile. Faster is higher. */
function Profile({ x }) {
  const pts = x.pts || []
  if (pts.length < 3) return null
  const W = 340, H = 150, L = 34, B = 18, T = 8, R = 6
  const dMax = pts[pts.length - 1][3] || 1
  const bike = x.sport === 'bike'
  const sp = pts.map(p => p[4] / 100)
  const sorted = [...sp].filter(v => v > 0).sort((a, b) => a - b)
  const lo = (sorted[Math.floor(sorted.length * 0.05)] ?? 1) * 0.9, hi = (sorted[Math.floor(sorted.length * 0.95)] ?? 3) * 1.1
  const X = d => L + (d / dMax) * (W - L - R)
  const Y = v => T + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo || 1)) * (H - T - B)
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[3]).toFixed(1)} ${Y(sp[i]).toFixed(1)}`).join('')
  const els = pts.map(p => p[2]).filter(e => e != null)
  let area = null
  if (els.length === pts.length) {
    const e0 = Math.min(...els), e1 = Math.max(...els), span = Math.max(20, e1 - e0)
    const EY = e => H - B - ((e - e0) / span) * (H - T - B) * 0.45
    area = `M${X(0)} ${H - B}` + pts.map(p => `L${X(p[3]).toFixed(1)} ${EY(p[2]).toFixed(1)}`).join('') + `L${X(dMax)} ${H - B}Z`
  }
  const ticks = [lo + (hi - lo) * 0.15, (lo + hi) / 2, hi - (hi - lo) * 0.15]
  const tickText = v => (bike ? String(Math.round(v * 3.6)) : fmtClock(1000 / v))
  const kms = []
  for (let k = 0; k * 1000 <= dMax; k += Math.max(1, Math.ceil(dMax / 1000 / 6))) kms.push(k)
  return <svg className="cardio-profile" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={bike ? t('Speed') : t('Pace')}>
    {area && <path d={area} fill="var(--acc-soft)" />}
    {ticks.map((v, i) => <g key={i}>
      <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="var(--sep-op)" strokeWidth=".5" />
      <text x={L - 4} y={Y(v) + 3} textAnchor="end" className="cardio-ax">{tickText(v)}</text>
    </g>)}
    {kms.map(k => <text key={k} x={X(k * 1000)} y={H - 4} textAnchor="middle" className="cardio-ax">{k}</text>)}
    <path d={line} fill="none" stroke="var(--acc)" strokeWidth="2" strokeLinejoin="round" />
  </svg>
}

function Splits({ x }) {
  const sp = x.splits || []
  const bike = x.sport === 'bike'
  const full = sp.filter(s => s.full && s.pace > 0)
  const fast = full.length > 1 ? full.reduce((a, b) => (b.pace < a.pace ? b : a)).km : null
  const slow = full.length > 1 ? full.reduce((a, b) => (b.pace > a.pace ? b : a)).km : null
  const best = Math.min(...sp.map(s => s.pace || Infinity))
  return <div className="card cardio-table">
    <div className="cardio-th"><span>{t('km')}</span><span /><span>{bike ? t('Speed') : t('Pace')}</span><span>{t('Climb')}</span><span>{t('HR')}</span></div>
    {sp.map(s => {
      const v = speedLabel(x.sport, s.pace)
      return <div key={s.km} className={'cardio-tr' + (s.km === fast ? ' fast' : s.km === slow ? ' slow' : '')}>
        <span>{s.full ? s.km : fmtKm(sp.slice(0, s.km - 1).reduce((n, q) => n + q.distM, 0) + s.distM)}</span>
        <span className="cardio-barwrap"><i style={{ width: Math.max(8, Math.round((best / (s.pace || best)) * 100)) + '%' }} /></span>
        <b>{v.value}</b>
        <span>{s.elev == null ? '–' : (s.elev > 0 ? '+' : '') + s.elev}</span>
        <span>{s.hr ?? '–'}</span>
      </div>
    })}
  </div>
}

function Laps({ x }) {
  const bike = x.sport === 'bike'
  return <div className="card cardio-table">
    <div className="cardio-th laps"><span>{t('Lap')}</span><span>{t('Distance')}</span><span>{t('Time')}</span><span>{bike ? t('Speed') : t('Pace')}</span><span>{t('HR')}</span></div>
    {x.laps.map(l => <div key={l.n} className="cardio-tr laps">
      <span>{l.n}</span><span>{fmtKm(l.distM)}</span><span>{fmtClock(l.sec)}</span><b>{speedLabel(x.sport, l.pace).value}</b><span>{l.hr ?? '–'}</span>
    </div>)}
  </div>
}

const bestLabel = d => ({ 21098: t('Half marathon'), 42195: t('Marathon') })[d] || fmtKm(d) + ' ' + t('km')

/** Each insight id from lib/cardio-insights.js, in words. */
function insightText(i, sport) {
  const pace = s => speedLabel(sport, s)
  const km = m => fmtKm(m) + ' ' + t('km')
  switch (i.id) {
    case 'pr': return t('New personal best over {0}: {1}, {2} faster than before.', km(i.distM), fmtClock(i.sec), fmtClock(i.prevSec - i.sec))
    case 'negative': return t('Negative split: the second half was {0}% faster than the first.', fmtNum(i.pct))
    case 'fade': return t('You slowed down by {0}% in the second half.', fmtNum(i.pct))
    case 'even': return t('Very even pacing, every kilometre close to the same.')
    case 'range': return t('Fastest km: {0} at {1}. Slowest: {2} at {3}.', i.fastKm, withUnit(pace(i.fastPace)), i.slowKm, withUnit(pace(i.slowPace)))
    case 'drift': return t('Heart rate rose {0}% over the session at the same pace. Heat, tiredness or a start that was too fast can do that.', fmtNum(i.pct))
    case 'hilly': return t('A hilly one: {0} m of climb, {1} m per kilometre.', i.gain, i.perKm)
    case 'plan': return i.pct > 0
      ? t('{0}% further than the {1} you planned.', i.pct, km(i.planM))
      : t('{0}% shorter than the {1} you planned.', -i.pct, km(i.planM))
    case 'plan-met': return t('You did what you planned: {0}.', km(i.planM))
    case 'longest': return t('Your longest one so far.')
    case 'week': return i.pct > 0
      ? t('{0} km this week, {1}% more than your usual week.', fmtNum(i.km), i.pct)
      : t('{0} km this week, {1}% less than your usual week.', fmtNum(i.km), -i.pct)
    default: return null
  }
}

export function CardioDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const x = planOf(S, id)
  const insights = useMemo(() => (x?.status === 'done' ? insightsOf(x, S) : []), [x, S])
  if (!x) return <div className="narrow"><div className="hdr">
    <button className="iconbtn" data-back="/cardio" onClick={() => nav('/cardio')} aria-label={t('Cardio')}><Icon name="chevronLeft" /></button>
    <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{t('Cardio')}</h1></div></div>
    <div className="empty small">{t('This activity is gone')}</div></div>
  const done = x.status === 'done'
  const bike = x.sport === 'bike'
  const sp = done ? speedLabel(x.sport, avgPace(x)) : null
  const start = done ? x.pts?.find(p => p[0] != null) : null
  const bests = done ? Object.entries(x.best || {}) : []
  const remove = () => confirmSheet({
    title: t('Delete this activity?'), message: t('Deletes {0} from {1}.', titleOf(x), fmtDate(x.date, true)),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => { update(s => { removeSession(s, x.id) }); toast(t('Deleted')); nav('/cardio', { replace: true }) },
  })
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" data-back="/cardio" onClick={() => nav('/cardio')} aria-label={t('Cardio')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12, minWidth: 0 }}>
        <h1 style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{titleOf(x)}</h1>
        <div className="sub">{fmtDate(x.date, true)}{done && x.start ? ' · ' + timeOfDay(x.start) : ''}</div>
      </div>
      <button className="iconbtn" onClick={() => (done ? cardioPlanSheet(id) : openPlanned(x))} aria-label={t('Edit')}><Icon name="pencil" /></button>
      <button className="iconbtn" style={{ color: 'var(--red)' }} onClick={remove} aria-label={t('Delete')}><Icon name="trash" /></button>
    </div>

    {done && <>
      <div className="card cardio-stats">
        <Stat label={t('Distance')} value={fmtKm(x.distM)} unit={t('km')} />
        <Stat label={t('Moving time')} value={fmtClock(x.movingSec)} />
        <Stat label={bike ? t('Avg speed') : t('Avg pace')} value={sp.value} unit={unitText(sp.unit)} />
        <Stat label={t('Climb')} value={x.elevGain ?? 0} unit="m" />
        {x.avgHr != null && <Stat label={t('Avg heart rate')} value={x.avgHr} unit={t('bpm')} />}
        {x.maxHr != null && <Stat label={t('Max heart rate')} value={x.maxHr} unit={t('bpm')} />}
        {x.avgCad != null && <Stat label={t('Cadence')} value={x.avgCad} unit={bike ? t('rpm') : t('spm')} />}
        {x.elapsedSec - x.movingSec > 30 && <Stat label={t('Stopped')} value={fmtClock(x.elapsedSec - x.movingSec)} />}
      </div>

      {insights.length > 0 && <>
        <h4 className="sec">{t('Insights')}</h4>
        <div className="card cardio-insights">
          {insights.map(i => <div key={i.id} className="cardio-insight"><Icon name="sparkles" /><span>{insightText(i, x.sport)}</span></div>)}
        </div>
      </>}

      {x.pts?.some(p => p[0] != null) && <>
        <h4 className="sec">{t('Route')}</h4>
        <div className="card cardio-mapcard">
          <RouteMap pts={x.pts} />
          <div className="row between small dim" style={{ marginTop: 6 }}>
            <span>{t('Slower')} <i className="cardio-key" /> {t('faster')}</span>
            {start && <a className="cardio-link" target="_blank" rel="noopener noreferrer"
              href={`https://www.openstreetmap.org/?mlat=${start[0] / 1e5}&mlon=${start[1] / 1e5}#map=15/${start[0] / 1e5}/${start[1] / 1e5}`}>
              <Icon name="mapPin" /> {(start[0] / 1e5).toFixed(4)}, {(start[1] / 1e5).toFixed(4)}</a>}
          </div>
        </div>
      </>}

      <h4 className="sec">{bike ? t('Speed and climb') : t('Pace and climb')}</h4>
      <div className="card"><Profile x={x} />
        <div className="small dim" style={{ textAlign: 'center' }}>{t('km')} · {bike ? t('km/h') : t('min/km')}</div></div>

      <h4 className="sec">{t('Kilometres')}</h4>
      <Splits x={x} />

      {x.laps?.length > 1 && <><h4 className="sec">{t('Laps from your watch')}</h4><Laps x={x} /></>}

      {bests.length > 0 && <>
        <h4 className="sec">{t('Best efforts in this activity')}</h4>
        <div className="card cardio-bests">
          {bests.map(([d, b]) => <div key={d} className="row between">
            <span>{bestLabel(d)}</span>
            <b>{fmtClock(b.sec)}</b>
          </div>)}
        </div>
      </>}
    </>}
    {!done && <div className="card">
      <div className="row between"><span className="muted">{sportName(x.sport)}</span><b>{planLine(x) || t('Planned')}</b></div>
      {x.plan?.note && <div className="small dim" style={{ marginTop: 6 }}>{x.plan.note}</div>}
      <div className="small dim" style={{ marginTop: 10 }}>{t('Import the activity file from the Cardio screen to fill this in.')}</div>
    </div>}
  </div>
}
