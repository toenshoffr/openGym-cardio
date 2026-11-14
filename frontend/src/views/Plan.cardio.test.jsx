// @vitest-environment happy-dom
// Plan → Schedule with the weekly cardio (S.cardioWeek): a run or ride that comes every week shows
// on its weekday next to the routines, and a day with only cardio is not a rest day.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Plan from './Plan.jsx'
import { addSlot } from '../lib/cardio.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null }
  state.snapshot = () => ({ S: state.S, user: null, update: mut => { const next = structuredClone(state.S); mut(next); state.S = next } })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => (selector ? selector(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('../lib/coach.js', () => ({ coachAvailable: () => false }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), dayAssignSheet: vi.fn(), menuSheet: vi.fn(), confirmSheet: vi.fn(),
  planHasRoutines: () => true, exportPlanFile: vi.fn(), printWholePlan: vi.fn(), importPlanFile: vi.fn(),
}))

let host, root
beforeEach(() => {
  localStorage.removeItem('gym_plan_view')
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mount = (fn, modules) => {
  const S = {
    unit: 'kg', workouts: [], exWeights: {}, week: { 1: ['r1'] }, dayPlan: {}, cardioWeek: {}, modules,
    routines: [{ id: 'r1', name: 'Push', emoji: null, ex: [{ id: '0025' }] }],
  }
  fn?.(S)
  mocks.S = S
  act(() => root.render(<Plan />))
}
const day = d => host.querySelector(`.plan-day[data-day="${d}"]`)
const text = (d, sel) => day(d).querySelector(sel).textContent

describe('the weekday rows with weekly cardio', () => {
  it('a day with only a run is that run, not a rest day', () => {
    mount(S => { addSlot(S, { wd: 2, sport: 'run', title: 'Tempo', distM: 8000, sec: 2400 }) })
    expect(text(2, '.tt')).toBe('Tempo')
    expect(text(2, '.ss')).toBe('Tempo · 8 km · 40:00')
    expect(day(2).querySelector('.lrow-i').className).not.toContain('rest')
    expect(text(3, '.tt')).toBe('Rest day')
  })

  it('a day with a routine and a ride shows both', () => {
    mount(S => { addSlot(S, { wd: 1, sport: 'bike', distM: 30000 }) })
    expect(text(1, '.tt')).toBe('Push')
    expect(text(1, '.ss')).toBe('1 exercise · Ride · 30 km')
  })

  it('two on one day are listed together', () => {
    mount(S => { addSlot(S, { wd: 6, sport: 'run' }); addSlot(S, { wd: 6, sport: 'bike' }) })
    expect(text(6, '.tt')).toBe('Run + Ride')
  })

  it('nothing of it with the Cardio module off', () => {
    mount(S => { addSlot(S, { wd: 2, sport: 'run', title: 'Tempo' }) }, { cardio: false })
    expect(text(2, '.tt')).toBe('Rest day')
  })
})
