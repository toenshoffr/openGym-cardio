// Stats → Run and Stats → Ride (v1.5): one part of the page per sport, laid out like Lifts. All time
// in tiles, the year you pick (by month, against the year before), the last weeks, a row per year,
// the pace or speed over time, records, and the latest activities. The numbers are lib/cardio-stats.js.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import LineChart from './LineChart.jsx'
import Icon from './Icon.jsx'
import { Button, Segmented, SelectRow } from './ui.jsx'
import { fmtDate, fmtDur, fmtNum, todayISO, weekStartOf, MONTHS } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { fmtKm, fmtClock, fmtPace, speedLabel, avgPace } from '../lib/cardio.js'
import { sportSessions, totals, yearsOf, byYear, monthly, weekly, yearToDate, records, trend, BEST_KEYS } from '../lib/cardio-stats.js'
import './CardioStats.css'

const km = m => fmtKm(m) + ' ' + t('km')
const time = sec => fmtDur(Math.round(sec) * 1000)
const speedText = (sport, secPerKm) => { const v = speedLabel(sport, secPerKm); return v.value + (v.unit === 'km/h' ? ' ' + t('km/h') : t('/km')) }
const signed = pct => (pct > 0 ? '+' : '') + pct + '%'
const bestLabel = k => (k === 21098 ? t('Half marathon') : k === 42195 ? t('Marathon') : fmtKm(k) + ' ' + t('km'))

/** Bars for a list of { label, value, tip }: tallest = full height, an empty one a hairline. */
function Bars({ items, now = -1, label }) {
  const top = Math.max(1, ...items.map(i => i.value))
  return <div className="cs-bars" role="img" aria-label={label}>
    {items.map((i, k) => <div key={k} className={'cs-col' + (k === now ? ' now' : '')} title={i.tip}>
      <div className="cs-bar" style={{ height: Math.max(2, Math.round(i.value / top * 100)) + '%' }} />
      <div className="cs-lbl">{i.label}</div>
    </div>)}
  </div>
}

function Delta({ cur, prev, text }) {
  if (!(prev > 0) || !(cur >= 0)) return null
  const pct = Math.round((cur - prev) / prev * 100)
  return <div className={'small cs-delta' + (pct > 0 ? ' up' : pct < 0 ? ' down' : '')}>{text(signed(pct))}</div>
}

const RANGES = () => [{ value: 30, label: '1M' }, { value: 90, label: '3M' }, { value: 365, label: '1Y' }, { value: 0, label: t('All') }]

export default function CardioStats({ S, sport }) {
  const nav = useNavigate()
  const bike = sport === 'bike'
  const id = sport === 'bike' ? 'bike' : 'run'
  const list = useMemo(() => sportSessions(S, sport), [S.cardio, sport]) // eslint-disable-line react-hooks/exhaustive-deps
  const years = yearsOf(list)
  const today = todayISO()
  const [picked, setYear] = useState(null)
  const [range, setRange] = useState(365)
  if (!list.length) return null
  const year = years.includes(picked) ? picked : years[0]
  const all = totals(list)
  const yrList = list.filter(x => x.date.startsWith(year + '-'))
  const yr = totals(yrList)
  const months = monthly(list, year)
  const thisYear = Number(today.slice(0, 4))
  const ytd = year === thisYear ? yearToDate(list, year, today) : null
  const prevYear = totals(list.filter(x => x.date.startsWith((year - 1) + '-')))
  const weeks = weekly(list, today, 12, weekStartOf(S))
  const rows = byYear(list)
  const rec = records(list, sport)
  const from = range ? Date.now() - range * 86400000 : 0
  const pts = trend(list, sport).filter(p => p.t >= from)
  const bestMonth = months.reduce((b, m) => (m.distM > (b?.distM || 0) ? m : b), null)
  const recent = [...list].reverse().slice(0, 5)
  const title = bike ? t('Ride') : t('Run')
  const open = x => nav('/cardio/' + encodeURIComponent(x.id))

  return <section className="stats-sect" id={'stats-' + id} data-stats-sect={id} aria-labelledby={'stats-h-' + id}>
    <h2 className="stats-sect-h" id={'stats-h-' + id}>{title}</h2>

    <div className="kpis" data-cardio-kpis>
      <div className="tile"><div className="l">{t('Activities')}</div><div className="v">{all.n}</div></div>
      <div className="tile"><div className="l">{t('Distance')}</div><div className="v">{km(all.distM)}</div></div>
      <div className="tile"><div className="l">{t('Time')}</div><div className="v">{time(all.movingSec)}</div></div>
    </div>
    <div className="kpis" data-cardio-kpis2>
      <div className="tile"><div className="l">{bike ? t('Avg speed') : t('Avg pace')}</div><div className="v">{speedText(sport, all.avgPace)}</div></div>
      <div className="tile"><div className="l">{t('Climb')}</div><div className="v">{fmtNum(all.elevGain)} m</div></div>
      {all.avgHr != null && <div className="tile"><div className="l">{t('Avg heart rate')}</div><div className="v">{all.avgHr} {t('bpm')}</div></div>}
    </div>

    <div className="card" data-cardio-year>
      <div className="row between">
        <h2 style={{ margin: 0 }}>{year}</h2>
        {years.length > 1 && <div className="cs-year-pick"><SelectRow title={t('Year')} value={year} onChange={v => setYear(Number(v))}
          options={years.map(y => ({ value: y, label: String(y) }))} /></div>}
      </div>
      <div className="cs-year-grid">
        <div><div className="muted small">{t('Distance')}</div><div className="cs-v">{km(yr.distM)}</div></div>
        <div><div className="muted small">{t('Activities')}</div><div className="cs-v">{yr.n}</div></div>
        <div><div className="muted small">{t('Time')}</div><div className="cs-v">{time(yr.movingSec)}</div></div>
        <div><div className="muted small">{t('Climb')}</div><div className="cs-v">{fmtNum(yr.elevGain)} m</div></div>
        <div><div className="muted small">{bike ? t('Avg speed') : t('Avg pace')}</div><div className="cs-v">{speedText(sport, yr.avgPace)}</div></div>
        <div><div className="muted small">{t('Longest')}</div><div className="cs-v">{yr.longest ? km(yr.longest.distM) : '–'}</div></div>
      </div>
      {ytd
        ? <Delta cur={ytd.cur.distM} prev={ytd.prev.distM} text={p => t('{0} distance compared with this time last year', p)} />
        : <Delta cur={yr.distM} prev={prevYear.distM} text={p => t('{0} distance compared with {1}', p, year - 1)} />}
      <h4 className="sec cs-sub">{t('Per month')}</h4>
      <Bars items={months.map(m => ({ label: t(MONTHS[m.month]).slice(0, 1), value: m.distM, tip: t(MONTHS[m.month]) + ' ' + year + ' · ' + km(m.distM) }))}
        now={year === thisYear ? new Date().getMonth() : -1} label={t('Per month')} />
      {bestMonth && bestMonth.distM > 0 && <div className="small dim cs-cap">{t(MONTHS[bestMonth.month])} · {km(bestMonth.distM)}</div>}
    </div>

    <div className="card" data-cardio-weeks>
      <h2>{t('Last 12 weeks')}</h2>
      <Bars items={weeks.map(w => ({ label: String(Number(w.from.slice(8))), value: w.distM, tip: fmtDate(w.from, true) + ' · ' + km(w.distM) }))}
        now={weeks.length - 1} label={t('Last 12 weeks')} />
      <div className="small dim cs-cap">{t('Active in {0} of the last 12 weeks', weeks.filter(w => w.n > 0).length)}</div>
    </div>

    {rows.length > 1 && <div className="card cs-years" data-cardio-years>
      <h2>{t('Years')}</h2>
      <div className="cs-yh"><span>{t('Year')}</span><span>{t('Distance')}</span><span>{t('Activities')}</span><span>{t('Time')}</span></div>
      {rows.map(r => <div key={r.year} className={'cs-yr' + (r.year === year ? ' on' : '')} role="button" tabIndex={0}
        onClick={() => setYear(r.year)} onKeyDown={e => { if (e.key === 'Enter') setYear(r.year) }}>
        <b>{r.year}</b><span>{km(r.distM)}</span><span>{r.n}</span><span>{time(r.movingSec)}</span>
      </div>)}
    </div>}

    <div className="card" data-cardio-trend>
      <h2>{bike ? t('Speed') : t('Pace')}</h2>
      <Segmented className="seg-range" value={range} onChange={setRange} options={RANGES()} />
      <div className="chart">
        {pts.length > 1
          ? <LineChart points={pts} h={150} unit={bike ? t('km/h') : ''} invert={!bike} fmtY={bike ? undefined : v => fmtPace(v)} />
          : <div className="empty small">{t('Fewer than two workouts in this period. Pick a longer one.')}</div>}
      </div>
      <div className="small dim cs-cap">{bike ? t('Average speed of each ride') : t('Average pace of each run, min/km')}</div>
    </div>

    <div className="card" data-cardio-records>
      <h2>{t('Records')}</h2>
      <div className="cs-rec">
        {[
          rec.longest && [t('Longest'), km(rec.longest.distM), rec.longest],
          rec.mostClimb && [t('Most climb'), fmtNum(rec.mostClimb.elevGain) + ' m', rec.mostClimb],
          rec.fastest && [t('Fastest average'), speedText(sport, avgPace(rec.fastest)), rec.fastest],
          ...BEST_KEYS.filter(k => rec.best[k]).map(k => [t('Best {0}', bestLabel(k)), fmtClock(rec.best[k].sec), rec.best[k].x]),
        ].filter(Boolean).map(([label, value, x]) => <div key={label} className="cs-rec-row" role="button" tabIndex={0}
          onClick={() => open(x)} onKeyDown={e => { if (e.key === 'Enter') open(x) }}>
          <span className="grow">{label}<span className="small dim"> · {fmtDate(x.date, true)}</span></span>
          <b>{value}</b>
        </div>)}
      </div>
    </div>

    <div className="row between stats-list-h">
      <h4 className="sec" style={{ margin: 0 }}>{t('Recent activities')}</h4>
      <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={() => nav('/cardio')}>{t('All')} {all.n}</Button>
    </div>
    <div className="list">{recent.map(x => <div key={x.id} className="card cardio-row" role="button" tabIndex={0}
      onClick={() => open(x)} onKeyDown={e => { if (e.key === 'Enter') open(x) }}>
      <div className="cardio-ico" data-sport={x.sport}><Icon name={bike ? 'bike' : 'figureRun'} /></div>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row between"><b className="cardio-title">{x.title || title}</b><span className="small dim">{fmtDate(x.date)}</span></div>
        <div className="small dim" style={{ marginTop: 2 }}>{km(x.distM)} · {fmtClock(x.movingSec)} · {speedText(sport, avgPace(x))}</div>
      </div>
    </div>)}</div>
  </section>
}
