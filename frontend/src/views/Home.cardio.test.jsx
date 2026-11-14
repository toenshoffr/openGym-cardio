// @vitest-environment happy-dom
// Cardio on Home (v1.5): a planned run or ride marks its day on the week strip in blue, a finished
// one turns the dot green, and today's sessions get a row under the strip that opens the session.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { addPlanned, addDone } from '../lib/cardio.js'
import { analyze } from '../lib/cardio-analyze.js'
import { parseGpx } from '../lib/cardio-parse.js'
import { makeTrack, gpxOf } from '../lib/cardio-fixtures.js'
import { todayISO, isoOf } from '../lib/format.js'
import Home from './Home.jsx'

const navs = []
vi.mock('react-router-dom', () => ({ useNavigate: () => to => navs.push(to) }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '', weighInsSheet: vi.fn(),
}))

let host, root
beforeEach(() => {
  navs.length = 0
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const plusDays = n => { const d = new Date(todayISO() + 'T12:00:00'); d.setDate(d.getDate() + n); return isoOf(d) }
const mount = (fn, modules) => {
  useStore.setState(s => {
    const S = { ...s.S, routines: [], workouts: [], dayPlan: {}, week: {}, active: null, cardio: {}, modules, homeMuscleSets: false }
    fn?.(S)
    return { S, user: null }
  })
  act(() => root.render(<Home />))
}
const dots = () => [...host.querySelectorAll('.week .wday')].map(d => d.querySelector('.dot').className.replace('dot', '').trim())
const rows = () => [...host.querySelectorAll('.cardio-today')]

describe('Home with Cardio', () => {
  it('marks a planned day in blue and shows today\'s planned run with its plan', () => {
    mount(S => { addPlanned(S, { sport: 'run', date: todayISO(), title: 'Tempo', distM: 8000, sec: 2400 }) })
    expect(dots()).toContain('cardio')
    const [r] = rows()
    expect(r.textContent).toContain('Cardio')
    expect(r.textContent).toContain('Tempo')
    expect(r.textContent).toContain('8 km · 40:00')
    expect(r.textContent).toContain('Import')
  })

  it('a day with a planned ride later in the week is blue, today has no row for it', () => {
    // Pick a day that is in this week's strip and not today.
    const today = new Date(todayISO() + 'T12:00:00')
    const other = today.getDay() === 0 ? -1 : 1
    mount(S => { addPlanned(S, { sport: 'bike', date: plusDays(other), distM: 40000 }) })
    expect(dots().filter(d => d === 'cardio')).toHaveLength(1)
    expect(rows()).toHaveLength(0)
  })

  it('a finished one turns the dot green and the row says Done with the numbers', () => {
    mount(S => { addDone(S, analyze(parseGpx(gpxOf(makeTrack({ legs: [[3000, 300]], t0: new Date().setHours(7, 0, 0, 0) })))), { title: 'Morning jog' }) })
    expect(dots()).toContain('done')
    const [r] = rows()
    expect(r.textContent).toContain('3 km · 15:00')
    expect(r.textContent).toContain('Done')
  })

  it('tapping the row opens the session', () => {
    let id
    mount(S => { id = addPlanned(S, { sport: 'run', date: todayISO() }) })
    act(() => rows()[0].click())
    expect(navs).toEqual(['/cardio/' + id])
  })

  it('nothing of it with the module off', () => {
    mount(S => { addPlanned(S, { sport: 'run', date: todayISO() }) }, { cardio: false })
    expect(dots()).not.toContain('cardio')
    expect(rows()).toHaveLength(0)
  })
})
