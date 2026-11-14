// @vitest-environment happy-dom
// Cardio in Stats: Run and Ride parts in the index once there is a session of that sport, the
// activity heatmap and the training-day count that include cardio days, and what a tap on a day does.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTrack, gpxOf } from '../lib/cardio-fixtures.js'
import { parseGpx } from '../lib/cardio-parse.js'
import { analyze } from '../lib/cardio-analyze.js'
import { addDone } from '../lib/cardio.js'
import { todayISO } from '../lib/format.js'
import Stats from './Stats.jsx'

const mocks = vi.hoisted(() => ({ S: null, navs: [], calendar: [], detail: [] }))
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector({ S: mocks.S })
  useStore.getState = () => ({ S: mocks.S, update: () => {} })
  return { useStore }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => to => mocks.navs.push(to) }))
vi.mock('../sheets.jsx', () => ({
  bwSheet: () => {}, goalSheet: () => {}, calendarSheet: iso => mocks.calendar.push(iso), workoutDetailSheet: w => mocks.detail.push(w.id), exerciseHistorySheet: () => {},
  dayOverrideSheet: () => {}, WorkoutRow: () => null, bwDeltaColor: () => 'inherit', weighInsSheet: () => {},
}))
vi.mock('../components/LineChart.jsx', () => ({ default: () => null }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null, BodyMapLegend: () => null }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const dayN = n => { const d = new Date(); d.setHours(7, 0, 0, 0); d.setDate(d.getDate() - n); return d }
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
const workout = n => { const d = dayN(n); return { id: 'w' + n, d: iso(d), start: d.getTime(), end: d.getTime() + 3600000, name: 'Push', entries: [{ id: '0025', target: { id: '0025', sets: 1, reps: 5 }, sets: [{ w: 60, r: 5, done: true }] }] } }
const cardio = (S, n, m = 5000, bike = false) => addDone(S, analyze(parseGpx(gpxOf(makeTrack({ legs: [[m, bike ? 120 : 300]], t0: dayN(n).getTime() }), { type: bike ? 'cycling' : 'running' }))))

let root, host
afterEach(() => { act(() => root.unmount()); host.remove(); window.history.replaceState(null, '', '#/'); mocks.navs = []; mocks.calendar = []; mocks.detail = [] })
function mount(fn, modules) {
  const S = { body: 'male', effort: 'rir', unit: 'kg', targetW: null, bodyweight: [], routines: [], exWeights: {}, workouts: [workout(1)], cardio: {}, modules }
  fn?.(S)
  mocks.S = S
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<Stats />))
}
const parts = () => [...host.querySelectorAll('.stats-index .seg button')].map(b => b.textContent)
const cell = n => host.querySelector(`.hm-c[title^="${iso(dayN(n))}"]`)

describe('Stats with cardio', () => {
  it('no Run or Ride part until there is a session of that sport', () => {
    mount()
    expect(parts()).toEqual(['Overview', 'Body', 'Lifts', 'Effort'])
    expect(host.querySelector('#stats-run')).toBeNull()
  })

  it('a run adds Run after Lifts, a ride adds Ride after it, Effort stays last', () => {
    mount(S => { cardio(S, 2) })
    expect(parts()).toEqual(['Overview', 'Body', 'Lifts', 'Run', 'Effort'])
    expect(host.querySelector('#stats-run h2.stats-sect-h').textContent).toBe('Run')
    expect(host.querySelector('#stats-bike')).toBeNull()
    act(() => root.unmount()); host.remove()
    mount(S => { cardio(S, 2); cardio(S, 3, 20000, true) })
    expect(parts()).toEqual(['Overview', 'Body', 'Lifts', 'Run', 'Ride', 'Effort'])
    expect(host.querySelector('#stats-bike')).toBeTruthy()
  })

  it('only a ride: just Ride', () => {
    mount(S => { cardio(S, 2, 20000, true) })
    expect(parts()).toEqual(['Overview', 'Body', 'Lifts', 'Ride', 'Effort'])
  })

  it('Cardio off hides both parts and every cardio day on the heatmap', () => {
    mount(S => { cardio(S, 2); cardio(S, 3, 20000, true) }, { cardio: false })
    expect(parts()).toEqual(['Overview', 'Body', 'Lifts', 'Effort'])
    expect(cell(2).className).toContain('l0')
    expect(host.querySelector('[data-training-days]').textContent).toBe('1 training day in the last 12 months')
  })
})

describe('the heatmap and the training days', () => {
  it('a cardio-only day is shaded and says what it was', () => {
    mount(S => { cardio(S, 2, 8000) })
    expect(cell(2).className).not.toContain('l0')
    expect(cell(2).title).toMatch(/· Cardio 8 km · 40 min$/)
    expect(cell(1).title).toContain('1 workout')
    expect(cell(3).className).toContain('l0')
  })

  it('a day with strength and cardio keeps the workout text and adds the cardio', () => {
    mount(S => { cardio(S, 1, 5000) })
    expect(cell(1).title).toMatch(/1 workout · Cardio 5 km · \d+ min · /)
  })

  it('counts a day once, strength or cardio or both', () => {
    mount(S => { cardio(S, 1); cardio(S, 2); cardio(S, 3, 20000, true); cardio(S, 3) })
    // day 1: workout + run; day 2: run; day 3: ride + run
    expect(host.querySelector('[data-training-days]').textContent).toBe('3 training days in the last 12 months')
  })

  it('a tap: a single run opens it, strength and a run open the calendar', () => {
    let id
    mount(S => { id = cardio(S, 2); cardio(S, 1) })
    act(() => cell(2).click())
    expect(mocks.navs).toEqual(['/cardio/' + id])
    act(() => cell(1).click())
    expect(mocks.calendar).toEqual([iso(dayN(1))])
    expect(mocks.detail).toEqual([])
  })

  it('a strength-only day still opens the workout', () => {
    mount()
    act(() => cell(1).click())
    expect(mocks.detail).toEqual(['w1'])
    expect(mocks.navs).toEqual([])
  })

  it('the day is today in the legend of a profile with no workouts at all', () => {
    mount(S => { S.workouts = []; cardio(S, 0) })
    expect(host.querySelector('[data-training-days]').textContent).toBe('1 training day in the last 12 months')
    expect(todayISO()).toBe(iso(dayN(0)))
  })
})
