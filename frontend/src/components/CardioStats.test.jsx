// @vitest-environment happy-dom
// Stats → Run / Ride: the tiles, the year you pick against the year before, a row per year, the
// pace or speed trend, the records, and nothing at all for a sport with no sessions.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTrack, gpxOf } from '../lib/cardio-fixtures.js'
import { parseGpx } from '../lib/cardio-parse.js'
import { analyze } from '../lib/cardio-analyze.js'
import { addDone } from '../lib/cardio.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ navs: [], chart: null }))
vi.mock('react-router-dom', () => ({ useNavigate: () => to => mocks.navs.push(to) }))
vi.mock('./LineChart.jsx', () => ({ default: props => { mocks.chart = props; return <div data-chart /> } }))

const { default: CardioStats } = await import('./CardioStats.jsx')

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 12, 12)) })
afterAll(() => { vi.useRealTimers() })

let host, root
beforeEach(() => {
  mocks.navs = []; mocks.chart = null
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const add = (S, y, mo, d, m, pace, o = {}) => addDone(S, analyze(parseGpx(gpxOf(makeTrack({ legs: [[m, pace]], t0: new Date(y, mo - 1, d, 7).getTime(), ele: o.ele }), { type: o.sport === 'bike' ? 'cycling' : 'running' }))))
const seed = () => {
  const S = { cardio: {}, workouts: [], unit: 'kg' }
  add(S, 2025, 3, 10, 5000, 330)
  const long = add(S, 2025, 11, 2, 10000, 330)
  add(S, 2026, 1, 15, 8000, 300, { ele: m => 400 + m / 40 })
  add(S, 2026, 10, 20, 6000, 270)
  add(S, 2026, 2, 3, 30000, 120, { sport: 'bike' })
  add(S, 2026, 3, 8, 40000, 110, { sport: 'bike' })
  return { S, long }
}
const mount = (S, sport = 'run') => act(() => root.render(<CardioStats S={S} sport={sport} />))
const tiles = sel => [...host.querySelectorAll(sel + ' .tile')].map(t => [t.querySelector('.l').textContent, t.querySelector('.v').textContent])

describe('Stats → Run', () => {
  it('has nothing to say without a session of that sport', () => {
    mount({ cardio: {}, workouts: [] })
    expect(host.innerHTML).toBe('')
    const { S } = seed()
    delete S.cardio
    mount(S)
    expect(host.innerHTML).toBe('')
  })

  it('is its own part of the page, headed Run', () => {
    mount(seed().S)
    const s = host.querySelector('section')
    expect(s.id).toBe('stats-run')
    expect(s.dataset.statsSect).toBe('run')
    expect(host.querySelector('h2.stats-sect-h').textContent).toBe('Run')
  })

  it('all-time tiles: activities, distance, time, pace, climb', () => {
    mount(seed().S)
    expect(tiles('[data-cardio-kpis]').map(x => x[0])).toEqual(['Activities', 'Distance', 'Time'])
    expect(tiles('[data-cardio-kpis]')[0][1]).toBe('4')
    expect(tiles('[data-cardio-kpis]')[1][1]).toMatch(/^29\.\d+ km$|^29 km$|^28\.9\d? km$/)
    expect(tiles('[data-cardio-kpis2]').map(x => x[0])).toEqual(['Avg pace', 'Climb'])
    expect(tiles('[data-cardio-kpis2]')[0][1]).toMatch(/^5:\d\d\/km$/)
    expect(tiles('[data-cardio-kpis2]')[1][1]).toMatch(/^\d+ m$/)
  })

  it('opens on the newest year, with the compare line against this time last year', () => {
    mount(seed().S)
    const card = host.querySelector('[data-cardio-year]')
    expect(card.querySelector('h2').textContent).toBe('2026')
    expect(card.textContent).toContain('Activities')
    // 2026 to 12 Nov: 8 + 6 km. 2025 to 12 Nov: 5 + 10 km (the 2 November run counts, it is before the 12th).
    expect(card.querySelector('.cs-delta').textContent).toBe('-7% distance compared with this time last year')
    expect(card.querySelector('.cs-delta').className).toContain('down')
    expect(card.querySelectorAll('.cs-col')).toHaveLength(12)
    expect(card.querySelector('.cs-col.now .cs-lbl').textContent).toBe('N')
  })

  it('a row of the Years card picks that year, and the compare line becomes year against year', () => {
    mount(seed().S)
    const rows = [...host.querySelectorAll('.cs-yr')]
    expect(rows.map(r => r.querySelector('b').textContent)).toEqual(['2026', '2025'])
    act(() => rows[1].click())
    const card = host.querySelector('[data-cardio-year]')
    expect(card.querySelector('h2').textContent).toBe('2025')
    expect(host.querySelector('.cs-yr.on b').textContent).toBe('2025')
    // No 2024 to compare with: no line at all.
    expect(card.querySelector('.cs-delta')).toBeNull()
    expect(card.querySelector('.cs-col.now')).toBeNull()
    act(() => host.querySelector('.cs-yr').click())
    expect(host.querySelector('[data-cardio-year] .cs-delta').textContent).toContain('this time last year')
  })

  it('the last twelve weeks and how many had a run', () => {
    mount(seed().S)
    const weeks = host.querySelector('[data-cardio-weeks]')
    expect(weeks.querySelectorAll('.cs-col')).toHaveLength(12)
    expect(weeks.textContent).toContain('Active in 1 of the last 12 weeks')
  })

  it('pace trend: faster is up, minutes and seconds on the axis', () => {
    mount(seed().S)
    expect(mocks.chart.invert).toBe(true)
    expect(mocks.chart.unit).toBe('')
    expect(mocks.chart.fmtY(330)).toBe('5:30')
    expect(mocks.chart.points.length).toBeGreaterThan(0)
    expect(host.querySelector('[data-cardio-trend] h2').textContent).toBe('Pace')
  })

  it('records point at the session they happened in', () => {
    const { S, long } = seed()
    mount(S)
    const rows = [...host.querySelectorAll('.cs-rec-row')]
    const labels = rows.map(r => r.querySelector('.grow').firstChild.textContent)
    expect(labels).toEqual(expect.arrayContaining(['Longest', 'Most climb', 'Fastest average', 'Best 1 km', 'Best 5 km', 'Best 10 km']))
    expect(labels).not.toContain('Best Half marathon')
    act(() => rows[0].click())
    expect(mocks.navs).toEqual(['/cardio/' + long])
  })

  it('recent activities, newest first, and All goes to the Cardio screen', () => {
    mount(seed().S)
    expect(host.querySelectorAll('.cardio-row')).toHaveLength(4)
    const dates = [...host.querySelectorAll('.cardio-row .row .small')].map(e => e.textContent)
    expect(dates[0]).toContain('20')
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent === 'All 4').click())
    expect(mocks.navs).toEqual(['/cardio'])
  })
})

describe('Stats → Ride', () => {
  it('shows speed, not pace, and only the rides', () => {
    mount(seed().S, 'bike')
    expect(host.querySelector('h2.stats-sect-h').textContent).toBe('Ride')
    expect(host.querySelector('section').id).toBe('stats-bike')
    expect(tiles('[data-cardio-kpis]')[0][1]).toBe('2')
    expect(tiles('[data-cardio-kpis2]')[0][0]).toBe('Avg speed')
    expect(tiles('[data-cardio-kpis2]')[0][1]).toMatch(/^\d+(\.\d)? km\/h$/)
    expect(mocks.chart.invert).toBe(false)
    expect(mocks.chart.unit).toBe('km/h')
    expect(host.querySelector('[data-cardio-trend] h2').textContent).toBe('Speed')
  })
})
