// Picks activity files up (the screen's file input, or a test's stand-ins), reads each one, and
// stores it as a done session, filling the planned one it belongs to. One result per file, so a
// batch of ten from a Strava export reports "8 added, 2 already there" instead of failing whole.
//
//   { name, status: 'added' | 'duplicate' | 'error', id?, planned? (a session was filled), code? }
//
// `code` is a CardioError's (cardio-error.js) or 'read' for a file the browser could not open.
import { parseActivity } from './cardio-parse.js'
import { analyze } from './cardio-analyze.js'
import { addDone, findDuplicate, planOf, suggestMatch } from './cardio.js'

/**
 * @param {File[]} files        anything with `name` and `arrayBuffer()`
 * @param {() => object} getS   the current state (read fresh for every file)
 * @param {(fn: (s: object) => void) => void} update   the store's update
 * @param {{ matchId?: string }} opts   fill this planned session (the file's own pick of one otherwise)
 */
export async function importActivityFiles(files, getS, update, { matchId = null } = {}) {
  const results = []
  for (const file of files) {
    const name = file?.name || ''
    let bytes
    try { bytes = new Uint8Array(await file.arrayBuffer()) } catch { results.push({ name, status: 'error', code: 'read' }); continue }
    let a
    try { a = analyze(await parseActivity(bytes)) } catch (e) {
      results.push({ name, status: 'error', code: e?.code || 'format' })
      continue
    }
    if (findDuplicate(getS(), a)) { results.push({ name, status: 'duplicate' }); continue }
    // An explicit pick only counts while that session is still planned; otherwise the file finds its own.
    const picked = matchId && planOf(getS(), matchId)?.status === 'planned' ? planOf(getS(), matchId) : null
    const match = picked || suggestMatch(getS(), a)
    let id = null
    update(s => { id = addDone(s, a, { matchId: match?.id || null }) })
    results.push({ name, status: 'added', id, planned: !!match })
  }
  return results
}
