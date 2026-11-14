// The form that plans (or edits) one run or ride (v1.5, Cardio). A component of its own so the
// Cardio screen and the day sheet on Home (sheets.jsx DayOverride) open the same thing.
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import DateField from './DateField.jsx'
import { Button, NumberField, Segmented, TextField, TextArea } from './ui.jsx'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { addPlannedWeekly, editSession, removeSession } from '../lib/cardio.js'

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
  const [weeks, setWeeks] = useState(1)
  const done = existing?.status === 'done'
  const save = () => {
    const plan = { distM: km > 0 ? km * 1000 : 0, sec: min > 0 ? min * 60 : 0, note }
    if (existing) update(s => { editSession(s, id, { sport, date, title, plan }) })
    else update(s => { addPlannedWeekly(s, { sport, date, title, distM: plan.distM, sec: plan.sec, note }, weeks) })
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
    {!existing && <div className="cardio-repeat">
      <span className="muted small">{t('Repeat weekly')}</span>
      <Segmented value={weeks} onChange={setWeeks} options={[1, 4, 8, 12].map(n => ({ value: n, label: n + '×' }))} />
    </div>}
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
