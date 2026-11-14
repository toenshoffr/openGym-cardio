// @vitest-environment happy-dom
// Plan → Schedule → a weekday: the Cardio part of the weekday picker. Weekly runs and rides are
// added, edited and removed there (S.cardioWeek); the routines below are untouched.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { dayAssignSheet } from './sheets.jsx'
import { addSlot, slotsOnWeekday } from './lib/cardio.js'

const clone = v => JSON.parse(JSON.stringify(v))
const mounted = []
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
const btn = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.startsWith(text))
const S = () => useStore.getState().S
const setS = fn => useStore.setState(s => { const n = clone(s.S); n.routines = [{ id: 'push', name: 'Push', emoji: null, ex: [{ id: '0025' }] }]; n.week = { 2: ['push'] }; n.dayPlan = {}; n.cardioWeek = {}; delete n.modules; fn?.(n); return { S: n, user: null } })

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }) })

describe('the weekday picker with weekly cardio', () => {
  it('Add a run opens the weekly form for that weekday and saves a slot', () => {
    setS()
    dayAssignSheet(2)
    const picker = renderTop()
    expect([...picker.querySelectorAll('h4.sec')].map(h => h.textContent)).toEqual(['Cardio', 'Strength'])
    act(() => row(picker, 'Add a run').click())
    const form = renderTop()
    expect(form.textContent).toContain('Every Tuesday')
    act(() => btn(form, 'Save').click())
    const [x] = slotsOnWeekday(S(), 2)
    expect(x).toMatchObject({ wd: 2, sport: 'run' })
    expect(Object.keys(S().cardioWeek)).toHaveLength(1)
  })

  it('Add a ride is a ride, and the form has no Skip for a new slot', () => {
    setS()
    dayAssignSheet(5)
    const picker = renderTop()
    act(() => row(picker, 'Add a ride').click())
    const form = renderTop()
    expect(btn(form, 'Skip')).toBeFalsy()
    expect(btn(form, 'Remove from weekly plan')).toBeFalsy()
    act(() => btn(form, 'Save').click())
    expect(slotsOnWeekday(S(), 5)[0]).toMatchObject({ wd: 5, sport: 'bike' })
  })

  it('lists the weekday\'s slots, edits one and removes it', () => {
    let id
    setS(n => { id = addSlot(n, { wd: 2, sport: 'run', title: 'Tempo', distM: 8000 }); addSlot(n, { wd: 4, sport: 'bike', title: 'Other day' }) })
    dayAssignSheet(2)
    const picker = renderTop()
    expect(row(picker, 'Tempo').querySelector('.ss').textContent).toBe('8 km')
    expect(row(picker, 'Other day')).toBeFalsy()
    act(() => row(picker, 'Tempo').click())
    const form = renderTop()
    act(() => [...form.querySelectorAll('button')].find(b => b.textContent === 'Ride').click())
    act(() => btn(form, 'Save').click())
    expect(S().cardioWeek[id]).toMatchObject({ sport: 'bike', title: 'Tempo', plan: { distM: 8000 } })
    dayAssignSheet(2)
    const second = renderTop()
    act(() => row(second, 'Tempo').click())
    const again = renderTop()
    act(() => btn(again, 'Remove from weekly plan').click())
    expect(S().cardioWeek[id]).toBeUndefined()
    expect(Object.values(S().cardioWeek).map(x => x.title)).toEqual(['Other day'])   // another day's slot stays
  })

  it('a day with only a weekly run is no rest day in the picker', () => {
    setS(n => { n.week = {}; addSlot(n, { wd: 2, sport: 'run' }) })
    dayAssignSheet(2)
    const picker = renderTop()
    expect(row(picker, 'Rest day').querySelector('.menu-on').className).not.toContain('is-on')
    setS(n => { n.week = {} })
    dayAssignSheet(2)
    expect(row(renderTop(), 'Rest day').querySelector('.menu-on').className).toContain('is-on')
  })

  it('is gone with the module off, and the routines stay as they were', () => {
    setS(n => { n.modules = { cardio: false } })
    dayAssignSheet(2)
    const picker = renderTop()
    expect(picker.querySelector('h4.sec')).toBeFalsy()
    expect(row(picker, 'Add a run')).toBeFalsy()
    expect(row(picker, 'Push').getAttribute('aria-pressed')).toBe('true')
  })
})
