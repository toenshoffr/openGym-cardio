// "Sync from Garmin" (v1.5, Settings → Integrations → Garmin Connect): asks the server, which holds
// the person's Garmin key (api/integrations/providers/garmin.js), for the newest runs and rides,
// leaves out the ones already here, downloads the original file of each new one and hands it to the
// same importer a picked file goes through (cardio-import.js), so a synced activity and an imported
// one are the same thing. Matching a planned session, the duplicate check and the analysis are all
// that code's.
//
// What counts as already here: a done session of the same sport that started within a minute of
// Garmin's start time (findDuplicate). Garmin's summary is not trusted for anything else; every
// number shown comes from the file.
import { importActivityFiles } from './cardio-import.js'
import { findDuplicate } from './cardio.js'
import { t } from './i18n.js'

export const PAGE = 50
export const MAX_PAGES = 4        // 200 activities back on a first sync, then it stops at what it knows
export const MAX_FILES = 25       // downloads in one go: a long first sync finishes over a few taps

const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0))

/**
 * @param {{ api: (path: string, o?: object) => Promise<any>, connId: string, getS: () => object,
 *   update: (fn: Function) => void, onProgress?: (done: number, total: number) => void }} o
 * @returns {{ added: number, planned: number, dupes: number, errors: number, left: number, stopped: string|null }}
 *   `left`: new activities not fetched this time (past MAX_FILES); `stopped`: the code of an error
 *   that ended the sync early (the key was refused, Garmin is busy), or null.
 */
export async function syncGarmin({ api, connId, getS, update, onProgress }) {
  const out = { added: 0, planned: 0, dupes: 0, errors: 0, left: 0, stopped: null }
  const fresh = []
  const ask = (op, body) => api('/api/integrations/pull', { method: 'POST', body: JSON.stringify({ id: connId, op, ...body }) })
  try {
    for (let page = 0, start = 0; page < MAX_PAGES; page++) {
      const r = await ask('list', { start, limit: PAGE })
      const items = Array.isArray(r?.items) ? r.items : []
      const news = items.filter(a => !findDuplicate(getS(), { start: a.start, sport: a.sport }))
      fresh.push(...news)
      out.dupes += items.length - news.length
      // A page with nothing new means everything older is already here.
      if (!r?.more || !news.length) break
      start = Number.isFinite(r.next) ? r.next : start + PAGE
    }
  } catch (e) { out.stopped = e?.code || 'garmin'; return out }
  // Oldest first, so an interrupted sync leaves no gap behind the newest one it got.
  fresh.sort((a, b) => a.start - b.start)
  const todo = fresh.slice(0, MAX_FILES)
  out.left = fresh.length - todo.length
  for (let i = 0; i < todo.length; i++) {
    onProgress?.(i, todo.length)
    let file
    try { file = await ask('file', { activity: todo[i].id }) } catch (e) {
      if (e?.code === 'key' || e?.code === 'busy' || e?.code === 'timeout' || e?.code === 'dns' || e?.code === 'network') { out.stopped = e.code; out.left += todo.length - i; break }
      out.errors++; continue
    }
    const bytes = b64(file.data)
    const [res] = await importActivityFiles([{ name: file.name, arrayBuffer: async () => bytes.buffer }], getS, update)
    if (res.status === 'added') { out.added++; if (res.planned) out.planned++ }
    else if (res.status === 'duplicate') out.dupes++
    else out.errors++
  }
  onProgress?.(todo.length, todo.length)
  return out
}

/** A sync's result in words: one toast. */
export function garminMessage(r) {
  if (r.stopped === 'key') return t('Garmin refused the key. It may have expired: make a new one on Garmin Connect.')
  if (r.stopped === 'busy') return t('Garmin says slow down. Try again in a few minutes.')
  if (r.stopped && !r.added) return t('Could not reach Garmin')
  if (!r.added && !r.errors && !r.left) return t('Nothing new on Garmin')
  const parts = [t('{0} imported from Garmin', r.added)]
  if (r.left) parts.push(t('{0} more to get: sync again', r.left))
  if (r.errors) parts.push(t('{0} could not be read', r.errors))
  return parts.join(', ')
}
