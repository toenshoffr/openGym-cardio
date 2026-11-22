// @vitest-environment happy-dom
// Cardio: the list with a planned and a done session, planning one, importing a file into a planned
// session, and the detail page (numbers, route, kilometres, laps, insights).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTrack, gpxOf, tcxOf } from '../lib/cardio-fixtures.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, sheets: [], navs: [], confirm: null, toasts: [], params: {} }
  state.snapshot = () => ({
    S: state.S,
    update: mut => { const next = structuredClone(state.S); mut(next); state.S = next },
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => (selector ? selector(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const api = { openSheet: render => { mocks.sheets.push(render) }, toast: m => mocks.toasts.push(m) }
  const useUI = sel => (sel ? sel(api) : api)
  useUI.getState = () => api
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => to => mocks.navs.push(to), useParams: () => mocks.params }))
vi.mock('../sheets.jsx', () => ({ confirmSheet: o => { mocks.confirm = o } }))

const { default: Cardio, CardioDetail, importMessage } = await import('./Cardio.jsx')
const { analyze } = await import('../lib/cardio-analyze.js')
const { parseGpx, parseTcx } = await import('../lib/cardio-parse.js')
const { addDone, addPlanned } = await import('../lib/cardio.js')

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 11, 12)) })
afterAll(() => { vi.useRealTimers() })

const T = new Date(2026, 10, 10, 7).getTime()
let host, root
beforeEach(() => {
  mocks.S = { unit: 'kg', weekStart: 1, cardio: {} }
  mocks.sheets = []; mocks.navs = []; mocks.confirm = null; mocks.toasts = []; mocks.params = {}
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const render = el => act(() => root.render(el))
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.includes(text) || b.getAttribute('aria-label') === text)
const click = el => act(() => el.click())
const seed = fn => { const s = structuredClone(mocks.S); const out = fn(s); mocks.S = s; return out }

describe('the Cardio list', () => {
  it('says what to do first on an empty profile', () => {
    render(<Cardio />)
    expect(host.textContent).toContain('Nothing planned')
    expect(host.textContent).toContain('No activities yet')
    expect(button('Import from Strava or Garmin')).toBeTruthy()
  })

  it('shows a planned session with its plan and a done one with its numbers', () => {
    seed(s => {
      addPlanned(s, { sport: 'bike', date: '2026-11-12', title: 'Long ride', distM: 60000, sec: 7200 })
      addDone(s, analyze(parseGpx(gpxOf(makeTrack({ legs: [[5000, 300]], t0: T })))))
    })
    render(<Cardio />)
    expect(host.textContent).toContain('Long ride')
    expect(host.textContent).toContain('60 km · 2:00:00')
    expect(host.textContent).toContain('5 km · 25:00 · 5:00/km')
    expect(button('Import into this session')).toBeTruthy()
  })

  it('plans a session from the sheet, for today unless the date is changed', () => {
    render(<Cardio />)
    click(button('Plan a session'))
    const sheet = document.createElement('div')
    document.body.appendChild(sheet)
    const r2 = createRoot(sheet)
    const close = vi.fn()
    act(() => r2.render(mocks.sheets[0](close)))
    const ride = [...sheet.querySelectorAll('button')].find(b => b.textContent === 'Ride')
    act(() => ride.click())
    act(() => [...sheet.querySelectorAll('button')].find(b => b.textContent === 'Save').click())
    const [x] = Object.values(mocks.S.cardio)
    expect(x).toMatchObject({ status: 'planned', sport: 'bike', date: '2026-11-11' })
    expect(close).toHaveBeenCalled()
    expect(mocks.toasts).toContain('Planned')
    act(() => r2.unmount()); sheet.remove()
  })

  it('opens a done session', () => {
    const id = seed(s => addDone(s, analyze(parseGpx(gpxOf(makeTrack({ legs: [[3000, 300]], t0: T }))))))
    render(<Cardio />)
    click([...host.querySelectorAll('.cardio-row')].find(r => r.textContent.includes('3 km')))
    expect(mocks.navs).toEqual(['/cardio/' + id])
  })
})

describe('the detail page', () => {
  it('shows totals, kilometres, route and insights of a run', () => {
    const id = seed(s => {
      const p = addPlanned(s, { sport: 'run', date: '2026-11-10', distM: 5000 })
      return addDone(s, analyze(parseGpx(gpxOf(makeTrack({ legs: [[3000, 330], [3000, 300]], t0: T, hr: () => 150, ele: m => 400 + m / 100 })))), { matchId: p })
    })
    mocks.params = { id }
    render(<CardioDetail />)
    const text = host.textContent
    expect(text).toContain('Distance')
    expect(text).toContain('Avg pace')
    expect(text).toContain('Negative split')
    expect(text).toContain('further than the 5 km you planned')
    expect(host.querySelectorAll('.cardio-tr').length).toBe(6)
    expect(host.querySelector('.cardio-map')).toBeTruthy()
    expect(host.querySelector('.cardio-profile')).toBeTruthy()
    expect(text).toContain('Best efforts')
    expect(host.querySelector('a.cardio-link').getAttribute('href')).toContain('openstreetmap.org')
  })

  it('shows speed, not pace, for a ride, and the laps of a watch', () => {
    const id = seed(s => addDone(s, analyze(parseTcx(tcxOf(makeTrack({ legs: [[4000, 120]], t0: T }), { sport: 'Biking' })))))
    mocks.params = { id }
    render(<CardioDetail />)
    expect(host.textContent).toContain('Avg speed')
    expect(host.textContent).toContain('Laps from your watch')
    expect(host.textContent).not.toContain('Avg pace')
  })

  it('shows a planned session without data, and a missing one', () => {
    const id = seed(s => addPlanned(s, { sport: 'run', date: '2026-11-12', distM: 8000 }))
    mocks.params = { id }
    render(<CardioDetail />)
    expect(host.textContent).toContain('8 km')
    expect(host.textContent).toContain('Import the activity file')
    mocks.params = { id: 'nope' }
    render(<CardioDetail />)
    expect(host.textContent).toContain('This activity is gone')
  })

  it('deletes after a confirmation', () => {
    const id = seed(s => addDone(s, analyze(parseGpx(gpxOf(makeTrack({ legs: [[3000, 300]], t0: T }))))))
    mocks.params = { id }
    render(<CardioDetail />)
    click(button('Delete'))
    act(() => mocks.confirm.onConfirm())
    expect(mocks.S.cardio[id]).toBeUndefined()
    expect(mocks.navs).toContain('/cardio')
  })
})

describe('the week card', () => {
  const sunday = new Date(2026, 10, 8, 7).getTime()          // the clock stands on Wednesday 11 November
  it('is the week the profile starts on: Monday leaves a Sunday run in last week, Sunday takes it in', () => {
    seed(s => { addDone(s, analyze(parseGpx(gpxOf(makeTrack({ legs: [[3000, 300]], t0: sunday }))))) })
    render(<Cardio />)
    expect(host.querySelector('.cardio-week .big').textContent).toContain('0')
    act(() => root.unmount()); host.remove()
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    mocks.S.weekStart = 0
    render(<Cardio />)
    expect(host.querySelector('.cardio-week .big').textContent).toContain('3')
  })
})

describe('editing a finished session', () => {
  it('can change its sport and title but not the day it was done on', () => {
    const id = seed(s => addDone(s, analyze(parseGpx(gpxOf(makeTrack({ legs: [[3000, 300]], t0: T }))))))
    mocks.params = { id }
    render(<CardioDetail />)
    click(button('Edit'))
    const sheet = document.createElement('div'); document.body.appendChild(sheet)
    const r2 = createRoot(sheet)
    act(() => r2.render(mocks.sheets.at(-1)(() => {})))
    expect(sheet.textContent).toContain('Edit session')
    expect(sheet.textContent).toContain('Ride')
    expect(sheet.querySelector('input[placeholder="Title (optional)"]')).toBeTruthy()
    expect(sheet.textContent).not.toContain('Date')
    expect(sheet.textContent).not.toContain('Distance (km)')
    act(() => [...sheet.querySelectorAll('button')].find(b => b.textContent === 'Ride').click())
    act(() => [...sheet.querySelectorAll('button')].find(b => b.textContent === 'Save').click())
    expect(mocks.S.cardio[id].sport).toBe('bike')
    act(() => r2.unmount()); sheet.remove()
  })
})

describe('importMessage', () => {
  it('says what the new refusals mean', () => {
    expect(importMessage([{ status: 'error', code: 'nozip' }])).toBe('No activity files in that zip')
    expect(importMessage([{ status: 'error', code: 'full' }])).toBe('Your profile is full: delete some old activities to import more')
  })
  it('words one file and a batch', () => {
    expect(importMessage([{ status: 'added', planned: true }])).toContain('matched')
    expect(importMessage([{ status: 'duplicate' }])).toBe('Already imported')
    expect(importMessage([{ status: 'error', code: 'zip' }])).toContain('zip')
    expect(importMessage([{ status: 'added' }, { status: 'added' }, { status: 'duplicate' }, { status: 'error', code: 'format' }]))
      .toBe('2 imported, 1 already there, 1 could not be read')
  })
})
