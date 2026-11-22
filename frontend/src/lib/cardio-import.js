// Picks activity files up (the screen's file input, or a test's stand-ins), reads each one, and
// stores it as a done session, filling the planned one it belongs to. One result per file, so a
// batch of ten from a Strava export reports "8 added, 2 already there" instead of failing whole.
//
//   { name, status: 'added' | 'duplicate' | 'error', id?, planned? (a session was filled), code? }
//
// `code` is a CardioError's (cardio-error.js), 'read' for a file the browser could not open, 'nozip' for a
// zip with no activity file in it, or 'full' when the profile has no room left (below).
//
// A zip (Garmin's "Export Original", Strava's archive) is opened and every activity file in it is imported
// as `archive.zip/activities/123.fit.gz`. Between two files the page gets the thread back, so a few hundred
// files from an archive do not freeze it.
//
// The room: the profile is one document and the API takes 5 MB of it, which a push over it would be refused
// for, silently losing sync. An import stops before the document passes DOC_LIMIT (4 MB, a margin for what
// else is written meanwhile) and says so.
import { parseActivity } from './cardio-parse.js'
import { analyze } from './cardio-analyze.js'
import { addDone, findDuplicate, planOf, suggestMatch } from './cardio.js'
import { listZip, looksLikeZip } from './cardio-zip.js'

export const DOC_LIMIT = 4 * 1024 * 1024
const SLICE_MS = 30
const tick = () => new Promise(r => setTimeout(r, 0))

/** The things to import: each file, or each activity file inside a zip. { name, bytes | load() } or { name, error }. */
async function* items(files) {
  for (const file of files) {
    const name = file?.name || ''
    let bytes
    try { bytes = new Uint8Array(await file.arrayBuffer()) } catch { yield { name, error: 'read' }; continue }
    if (!looksLikeZip(bytes)) { yield { name, bytes }; continue }
    let entries
    try { entries = listZip(bytes) } catch (e) { yield { name, error: e?.code || 'format' }; continue }
    if (!entries.length) { yield { name, error: 'nozip' }; continue }
    for (const e of entries) yield { name: name + '/' + e.name, load: e.read }
  }
}

/**
 * @param {File[]} files        anything with `name` and `arrayBuffer()`
 * @param {() => object} getS   the current state (read fresh for every file)
 * @param {(fn: (s: object) => void) => void} update   the store's update
 * @param {{ matchId?: string }} opts   fill this planned session (the file's own pick of one otherwise)
 */
export async function importActivityFiles(files, getS, update, { matchId = null } = {}) {
  const results = []
  let used = null, last = Date.now()
  for await (const item of items(files)) {
    if (Date.now() - last > SLICE_MS) { await tick(); last = Date.now() }
    const { name } = item
    if (item.error) { results.push({ name, status: 'error', code: item.error }); continue }
    if (used === null) { try { used = JSON.stringify(getS()).length } catch { used = 0 } }
    // Once it is full nothing more is read: every file left is the same answer, and cheap.
    if (used > DOC_LIMIT) { results.push({ name, status: 'error', code: 'full' }); continue }
    let a
    try { a = analyze(await parseActivity(item.bytes || await item.load())) } catch (e) {
      results.push({ name, status: 'error', code: e?.code || 'format' })
      continue
    }
    if (findDuplicate(getS(), a)) { results.push({ name, status: 'duplicate' }); continue }
    // An explicit pick only counts while that session is still planned; otherwise the file finds its own.
    const picked = matchId && planOf(getS(), matchId)?.status === 'planned' ? planOf(getS(), matchId) : null
    const match = picked || suggestMatch(getS(), a)
    let id = null
    update(s => { id = addDone(s, a, { matchId: match?.id || null }) })
    used += JSON.stringify(a).length + 64
    results.push({ name, status: 'added', id, planned: !!match })
  }
  return results
}
