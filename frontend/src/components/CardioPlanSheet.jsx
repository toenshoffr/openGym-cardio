// The form that plans (or edits) one run or ride (v1.5, Cardio). A component of its own so the
// Cardio screen and the day sheet on Home (sheets.jsx DayOverride) open the same thing.
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import DateField from './DateField.jsx'
import { Button, NumberField, Segmented, TextField, TextArea } from './ui.jsx'
import { todayISO, fmtDate, DAYN } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { addPlanned, editSession, removeSession, addSlot, editSlot, removeSlot } from '../lib/cardio.js'

const update = fn => useStore.getState().update(fn)
const toast = m => useUI.getState().toast(m)
const sportOptions = () => [{ value: 'run', label: t('Run') }, { value: 'bike', label: t('Ride') }]

function CardioPlanSheet({ id, date: startDate, sport: startSport, close }) {
  const existing = id ? useStore.getState().S.cardio?.[id] : null
  const [sport, setSport] = useState(existing?.sport || startSport || 'run')
  const [date, setDate] = useState(existing?.date || startDate || todayISO())
  const [km, setKm] = useState(existing?.plan?.distM ? existing.plan.distM / 1000 : null)
  const [min, setMin] = useState(existing?.plan?.sec ? Math.round(existing.plan.sec / 60) : null)
  const [title, setTitle] = useState(existing?.title || '')
  const [note, setNote] = useState(existing?.plan?.note || '')
  const done = existing?.status === 'done'
  const save = () => {
    const plan = { distM: km > 0 ? km * 1000 : 0, sec: min > 0 ? min * 60 : 0, note }
    if (existing) update(s => { editSession(s, id, { sport, date, title, plan }) })
    else update(s => { addPlanned(s, { sport, date, title, distM: plan.distM, sec: plan.sec, note }) })
    toast(existing ? t('Saved') : t('Planned'))
    close()
  }
  return <>
    <h3 className="sheet-title">{existing ? t('Edit session') : t('Plan a session')}</h3>
    <Segmented value={sport} onChange={setSport} options={sportOptions()} />
    <div style={{ height: 12 }} />
    <DateField value={date} onChange={setDate} label={t('Date')} />
    {!done && <div className="cardio-fields">
      <label><span className="muted small">{t('Distance (km)')}</span>
        <NumberField className="input" value={km} nullable onChange={setKm} placeholder="–" aria-label={t('Distance (km)')} /></label>
      <label><span className="muted small">{t('Time (min)')}</span>
        <NumberField className="input" value={min} nullable decimal={false} onChange={setMin} placeholder="–" aria-label={t('Time (min)')} /></label>
    </div>}
    <TextField value={title} maxLength={80} placeholder={t('Title (optional)')} onChange={e => setTitle(e.target.value)} />
    {!done && <><div style={{ height: 8 }} />
      <TextArea value={note} maxLength={500} rows={2} placeholder={t('Note (optional)')} onChange={e => setNote(e.target.value)} /></>}
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {existing && !done && <>
      <div style={{ height: 8 }} />
      <Button variant="ghost" style={{ color: 'var(--red)' }} onClick={() => { update(s => { removeSession(s, id) }); toast(t('Deleted')); close() }}>{t('Delete')}</Button>
    </>}
  </>
}

/** Opens the form: a new session (`id` null) for `date` and `sport`, or the one `id`. */
export const cardioPlanSheet = (id, date, sport) => useUI.getState().openSheet(close => <CardioPlanSheet id={id} date={date} sport={sport} close={close} />)

/* ------------------------------------------------------------ a weekly slot -- */

// One entry of the Plan screen's weekly rhythm (S.cardioWeek): the same run or ride every `wd`.
// Edited here it changes every day it covers from now on; "Skip" drops just the one day it was
// opened from (`date`, with that day's session id), which is how a week off is done.
function CardioSlotSheet({ id, wd, sport: startSport, date, sessionId, close }) {
  const existing = id ? useStore.getState().S.cardioWeek?.[id] : null
  const day = existing ? existing.wd : wd
  const [sport, setSport] = useState(existing?.sport || startSport || 'run')
  const [km, setKm] = useState(existing?.plan?.distM ? existing.plan.distM / 1000 : null)
  const [min, setMin] = useState(existing?.plan?.sec ? Math.round(existing.plan.sec / 60) : null)
  const [title, setTitle] = useState(existing?.title || '')
  const [note, setNote] = useState(existing?.plan?.note || '')
  const save = () => {
    const plan = { distM: km > 0 ? km * 1000 : 0, sec: min > 0 ? min * 60 : 0, note }
    if (existing) update(s => { editSlot(s, id, { sport, title, plan }) })
    else update(s => { addSlot(s, { wd: day, sport, title, distM: plan.distM, sec: plan.sec, note }) })
    toast(t('Saved'))
    close()
  }
  return <>
    <h3 className="sheet-title" style={{ marginBottom: 2 }}>{t('Weekly session')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Every {0}', t(DAYN[day]))}</div>
    <Segmented value={sport} onChange={setSport} options={sportOptions()} />
    <div className="cardio-fields">
      <label><span className="muted small">{t('Distance (km)')}</span>
        <NumberField className="input" value={km} nullable onChange={setKm} placeholder="–" aria-label={t('Distance (km)')} /></label>
      <label><span className="muted small">{t('Time (min)')}</span>
        <NumberField className="input" value={min} nullable decimal={false} onChange={setMin} placeholder="–" aria-label={t('Time (min)')} /></label>
    </div>
    <TextField value={title} maxLength={80} placeholder={t('Title (optional)')} onChange={e => setTitle(e.target.value)} />
    <div style={{ height: 8 }} />
    <TextArea value={note} maxLength={500} rows={2} placeholder={t('Note (optional)')} onChange={e => setNote(e.target.value)} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {existing && date && sessionId && <>
      <div style={{ height: 8 }} />
      <Button variant="ghost" onClick={() => { update(s => { removeSession(s, sessionId) }); toast(t('Skipped')); close() }}>{t('Skip {0}', fmtDate(date))}</Button>
    </>}
    {existing && <>
      <div style={{ height: 8 }} />
      <Button variant="ghost" style={{ color: 'var(--red)' }} onClick={() => { update(s => { removeSlot(s, id) }); toast(t('Deleted')); close() }}>{t('Remove from weekly plan')}</Button>
    </>}
  </>
}

/** Opens a weekly slot: a new one for weekday `wd`, or the slot `id` (with the day it was opened from, to skip it). */
export const cardioSlotSheet = ({ id = null, wd, sport, date, sessionId } = {}) =>
  useUI.getState().openSheet(close => <CardioSlotSheet id={id} wd={wd} sport={sport} date={date} sessionId={sessionId} close={close} />)

/**
 * What a tap on a planned session opens: the weekly slot it comes from (while that still exists),
 * else the one-off form.
 */
export function openPlanned(x) {
  const slotAlive = x.slot && useStore.getState().S.cardioWeek?.[x.slot]
  if (slotAlive) return cardioSlotSheet({ id: x.slot, date: x.date, sessionId: x.id })
  if (x.virtual) return null
  return cardioPlanSheet(x.id)
}
