// @vitest-environment happy-dom
// The day sheet (a tap on a day of Home's week strip) with the Cardio module: that day's runs and
// rides, and two rows that plan a new one for that very day. Off with the module.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { dayOverrideSheet } from './sheets.jsx'
import { addPlanned, addDone, cardioList, addSlot, planFor } from './lib/cardio.js'
import { analyze } from './lib/cardio-analyze.js'
import { parseGpx } from './lib/cardio-parse.js'
import { makeTrack, gpxOf } from './lib/cardio-fixtures.js'

const mounted = []
const clone = v => JSON.parse(JSON.stringify(v))
const ISO = '2026-11-18'

function renderTop() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const row = (host, name) => [...host.querySelectorAll('.item')].find(el => el.querySelector('.tt')?.textContent === name)
const headings = host => [...host.querySelectorAll('h4.sec')].map(h => h.textContent)
const setS = fn => useStore.setState(s => { const S = clone(s.S); S.routines = [{ id: 'r', name: 'Push', emoji: null, ex: [{ id: '0025' }] }]; S.week = {}; S.dayPlan = {}; S.workouts = []; S.active = null; S.queue = null; S.cardio = {}; S.cardioWeek = {}; delete S.modules; fn?.(S); return { S, user: null } })

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }) })

describe('the day sheet with Cardio', () => {
  it('offers a run and a ride for that day, above the routines', () => {
    setS()
    dayOverrideSheet(ISO)
    const host = renderTop()
    expect(headings(host)).toEqual(['Cardio', 'Strength'])
    expect(row(host, 'Plan a run')).toBeTruthy()
    expect(row(host, 'Plan a ride')).toBeTruthy()
  })

  it('Plan a ride opens the form on that day with Ride chosen, and saving plans it there', () => {
    setS()
    dayOverrideSheet(ISO)
    const day = renderTop()
    act(() => row(day, 'Plan a ride').click())
    // The day sheet closed itself and the plan form is the sheet on top now.
    const host = renderTop()
    expect(host.querySelector('h3').textContent).toBe('Plan a session')
    expect(host.textContent).toContain('18 Nov')
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent === 'Save').click())
    const [x] = cardioList(useStore.getState().S)
    expect(x).toMatchObject({ sport: 'bike', date: ISO, status: 'planned' })
  })

  it('a weekly slot shows on its weekday, a tap opens it, Skip drops just that day', () => {
    let slot
    setS(S => { slot = addSlot(S, { wd: 3, sport: 'run', title: 'Tempo', distM: 8000, from: '2026-11-01' }) })
    // 2026-11-18 is a Wednesday (wd 3).
    dayOverrideSheet(ISO)
    const day = renderTop()
    expect(row(day, 'Tempo').querySelector('.ss').textContent).toBe('8 km')
    act(() => row(day, 'Tempo').click())
    const form = renderTop()
    expect(form.querySelector('h3').textContent).toBe('Weekly session')
    expect(form.textContent).toContain('Every Wednesday')
    act(() => [...form.querySelectorAll('button')].find(b => b.textContent.startsWith('Skip')).click())
    expect(planFor(useStore.getState().S, ISO)).toEqual([])
    expect(planFor(useStore.getState().S, '2026-11-25')).toHaveLength(1)
    expect(useStore.getState().S.cardioWeek[slot]).toBeTruthy()
  })

  it('lists what is planned or done that day, and not other days', () => {
    setS(S => {
      addPlanned(S, { sport: 'run', date: ISO, title: 'Long run', distM: 15000 })
      addPlanned(S, { sport: 'bike', date: '2026-11-19', title: 'Other day' })
      addDone(S, analyze(parseGpx(gpxOf(makeTrack({ legs: [[3000, 300]], t0: new Date(2026, 10, 18, 7).getTime() })))), { title: 'Morning jog' })
    })
    dayOverrideSheet(ISO)
    const host = renderTop()
    expect(row(host, 'Long run').querySelector('.ss').textContent).toBe('15 km')
    expect(row(host, 'Morning jog').querySelector('.ss').textContent).toBe('3 km · 15:00')
    expect(row(host, 'Other day')).toBeFalsy()
  })

  it('is gone with the module switched off', () => {
    setS(S => { S.modules = { cardio: false } })
    dayOverrideSheet(ISO)
    const host = renderTop()
    expect(headings(host)).toEqual([])
    expect(row(host, 'Plan a run')).toBeFalsy()
  })
})
