// @vitest-environment happy-dom
// The training calendar (Home streak card, Stats) with cardio: a done run or ride marks its day like a
// workout, the month line adds the distance, a tap opens the session or a list of both, and a planned
// run shows as planned.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'

const navs = vi.hoisted(() => [])
vi.mock('./lib/nav.js', async orig => ({ ...(await orig()), nav: to => navs.push(to) }))

const { useStore } = await import('./store/useStore.js')
const { useUI } = await import('./store/useUI.js')
const { calendarSheet } = await import('./sheets.jsx')
const { addDone, addPlanned } = await import('./lib/cardio.js')
const { analyze } = await import('./lib/cardio-analyze.js')
const { parseGpx } = await import('./lib/cardio-parse.js')
const { makeTrack, gpxOf } = await import('./lib/cardio-fixtures.js')

const mounted = []
const clone = v => JSON.parse(JSON.stringify(v))
const render = () => {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const run = (S, d, m = 5000, title = '') => addDone(S, analyze(parseGpx(gpxOf(makeTrack({ legs: [[m, 300]], t0: new Date(2026, 10, d, 7).getTime() })))), { title })
// Main's calendar has more quiet lines (weeks in a row): the month line is the one with the numbers.
const monthLine = host => [...host.querySelectorAll('.small.muted')].find(e => /^(\d+ workouts? ·|Cardio ·|No workouts)/.test(e.textContent))?.textContent
const day = (host, n) => [...host.querySelectorAll('.cal-d')].find(b => b.querySelector('span').textContent === String(n))
const setS = fn => useStore.setState(s => { const S = clone(s.S); S.workouts = []; S.cardio = {}; S.cardioWeek = {}; S.routines = []; S.week = {}; S.dayPlan = {}; delete S.modules; fn?.(S); return { S } })
let original
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 10, 12))   // a planned day must not be a missed one
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; original = useStore.getState().S; navs.length = 0; useUI.setState({ sheets: [] }); document.body.innerHTML = '' })
afterEach(() => { vi.useRealTimers(); act(() => { mounted.splice(0).forEach(r => r.unmount()) }); useStore.setState({ S: original }) })

describe('the calendar with cardio', () => {
  it('marks a run day as trained and adds the distance to the month line', () => {
    setS(S => { run(S, 4, 5000); run(S, 9, 3000) })
    calendarSheet('2026-11-01')
    const host = render()
    expect(day(host, 4).className).toContain('has')
    expect(day(host, 4).querySelector('i').className).toBe('done')
    expect(day(host, 5).className).not.toContain('has')
    expect(monthLine(host)).toBe('Cardio · 8 km')
  })

  it('a planned run shows as planned, a weekly one too', () => {
    setS(S => { addPlanned(S, { sport: 'run', date: '2026-11-12' }) })
    calendarSheet('2026-11-01')
    const host = render()
    expect(day(host, 12).querySelector('i').className).toBe('plan')
    expect(day(host, 13).querySelector('i').className).toBe('')
  })

  it('a single run opens that session', () => {
    let id
    setS(S => { id = run(S, 4) })
    calendarSheet('2026-11-01')
    const host = render()
    act(() => day(host, 4).click())
    expect(navs).toEqual(['/cardio/' + id])
  })

  it('a day with a workout and a run lists both, and the month line has both', () => {
    let id
    setS(S => { id = run(S, 4, 5000, 'Jog'); S.workouts = [{ id: 'w1', d: '2026-11-04', start: new Date(2026, 10, 4, 18).getTime(), end: new Date(2026, 10, 4, 19).getTime(), name: 'Push', entries: [] }] })
    calendarSheet('2026-11-01')
    const host = render()
    expect(monthLine(host)).toMatch(/^1 workout · .* · Cardio 5 km$/)
    act(() => day(host, 4).click())
    const list = render()
    expect(list.textContent).toContain('Jog')
    expect(list.textContent).toContain('5 km · 25:00')
    act(() => [...list.querySelectorAll('.item')].find(i => i.textContent.includes('Jog')).click())
    expect(navs).toEqual(['/cardio/' + id])
  })

  it('with Cardio off a run day is just another day', () => {
    setS(S => { run(S, 4); S.modules = { cardio: false } })
    calendarSheet('2026-11-01')
    const host = render()
    expect(day(host, 4).className).not.toContain('has')
    expect(monthLine(host)).toBe('No workouts this month')
  })
})
