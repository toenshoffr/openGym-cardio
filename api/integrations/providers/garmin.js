/* Garmin Connect, by the Personal API (developer.garmin.com/gc-developer-program/personal): a
 * Garmin customer creates their own API key on Garmin Connect Web, and this server trades it for
 * a short-lived access token and pulls their activities. No business application with Garmin,
 * no webhook, no data about anyone but the key's owner (Garmin's FAQ: personal use only).
 *
 * What Garmin documents, and what this uses:
 *   POST  /personalapitoken-service/personal-api/personal-api-key/token   Authorization: ApiKey <key>
 *         -> an access token, valid 24 h or until the key expires, no refresh tokens
 *   GET   /activitylist-service/activities/search/activities?start&limit&sortOrder&activityType
 *         -> [SummarizedActivityDTO]  (activityId, startTimeGMT, activityType.typeKey, distance, ...)
 *   GET   /download-service/files/activity/{activityId}   -> a zip with the original file (FIT)
 *
 * NOT documented where this was written (Garmin's pages give the call but not the reply): the
 * token's JSON shape and how it is sent. The reply is read as JSON with access_token, accessToken
 * or token, or else as the bare token; it is sent as `Authorization: Bearer`. Verify against a
 * real key before relying on it (docs/CARDIO.md).
 *
 * It is a pull provider: no events, nothing in the outbox. The app asks (hub.pull) and imports the
 * files with the same code that reads a file the person picks. The key is sealed at rest like a
 * webhook's secret; the token only ever lives in memory. The host is fixed, so there is no
 * user-controlled URL here and nothing for net-guard to judge. */
import https from 'node:https';
import { firstEntry } from '../zip.js';

export const HOST = 'personal.connectapi.garmin.com';
export const TIMEOUT_MS = 20_000;
export const LIST_MAX = 100;
export const FILE_MAX = 30 * 1024 * 1024;
// A run is `running`, trail_running and so on under that parent; cycling likewise. Everything
// else (swimming, strength...) is left on Garmin.
export const SPORT_KEYS = { run: /run|treadmill/i, bike: /cycl|bik|ride|mtb|gravel/i };

/**
 * The headers of a request: what curl sends in Garmin's own example (any Accept, a user agent),
 * plus the caller's. A 406 from the token step was reported with a real key, so nothing narrower
 * than `*` is ever asked for, and a POST says it has no body.
 */
export const requestHeaders = (method, headers = {}) => ({
  'User-Agent': 'openGym', Accept: '*/*', ...headers, ...(method === 'POST' ? { 'Content-Length': 0 } : {}),
});

/** One request to the fixed host: { status, headers, body: Buffer }. Redirects are refusals. */
export function makeTransport() {
  return (method, pathAndQuery, { headers = {}, max = 1_000_000 } = {}) => new Promise((resolve, reject) => {
    const req = https.request({ host: HOST, path: pathAndQuery, method, headers: requestHeaders(method, headers), timeout: TIMEOUT_MS }, res => {
      const chunks = []; let n = 0;
      res.on('data', d => { n += d.length; if (n > max) { res.destroy(Object.assign(new Error('too big'), { code: 'ETOOBIG' })); return; } chunks.push(d); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end();
  });
}

const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

/** What went wrong with a call, in words the app shows. */
function explain(r, err, step = '') {
  if (err) {
    if (err.code === 'ETIMEDOUT') return fail(504, 'timeout', 'Garmin did not answer within 20 seconds.');
    if (err.code === 'ETOOBIG') return fail(502, 'big', 'Garmin sent more than expected.');
    if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') return fail(502, 'dns', 'Garmin could not be reached.');
    return fail(502, 'network', String(err.message || 'Could not connect.').slice(0, 120));
  }
  if (r.status === 401 || r.status === 403) return fail(401, 'key', 'Garmin refused the key. It may have expired or been deleted: make a new one on Garmin Connect.');
  if (r.status === 429) return fail(429, 'busy', 'Garmin says slow down. Try again in a few minutes.');
  if (r.status === 404) return fail(404, 'gone', 'Garmin has no such activity.');
  // Anything else: the status, the step it came from and the first of what Garmin said, so a report
  // of "Garmin answered 406" can be told apart from the next one.
  const said = Buffer.isBuffer(r.body) ? r.body.toString('utf8').replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  const printable = said && /^[\x20-\x7e\u00a0-\uffff]+$/.test(said) ? said : '';
  return fail(502, 'garmin', `Garmin answered ${r.status}${step ? ' at the ' + step + ' step' : ''}${printable ? ': ' + printable : ''}.`);
}

/** The token out of the token endpoint's reply, whatever shape it has (see the file's header). */
export function tokenOf(body) {
  const text = Buffer.isBuffer(body) ? body.toString('utf8').trim() : String(body || '').trim();
  if (!text) return null;
  try {
    const j = JSON.parse(text);
    const t = typeof j === 'string' ? j : j?.access_token ?? j?.accessToken ?? j?.token;
    return typeof t === 'string' && t ? t : null;
  } catch { return /^[\w.~+/=-]{16,4096}$/.test(text) ? text : null; }
}

export function garminProvider({ transport = null, now = Date.now } = {}) {
  const send = transport || makeTransport();
  const tokens = new Map();   // connection id -> { token, at }; memory only
  const TOKEN_MS = 20 * 3600_000;   // well inside the 24 h

  async function call(method, path, opts) {
    let r;
    try { r = await send(method, path, opts); } catch (e) { throw explain(null, e); }
    return r;
  }
  const stepOf = path => (path.startsWith('/personalapitoken') ? 'token' : path.startsWith('/activitylist') ? 'list' : path.startsWith('/download') ? 'file' : '');
  async function token(connId, apiKey, force = false) {
    const have = tokens.get(connId);
    if (!force && have && now() - have.at < TOKEN_MS) return have.token;
    // No Accept of our own, as in Garmin's example: the reply may be JSON or plain text.
    const r = await call('POST', '/personalapitoken-service/personal-api/personal-api-key/token', { headers: { Authorization: `ApiKey ${apiKey}` } });
    if (r.status < 200 || r.status >= 300) throw explain(r, null, 'token');
    const t = tokenOf(r.body);
    if (!t) throw fail(502, 'token', 'Garmin answered, but not with a token openGym can read.');
    tokens.set(connId, { token: t, at: now() });
    return t;
  }
  /** An authorised GET; one retry with a fresh token when the cached one was refused. */
  async function get(connId, apiKey, path, max) {
    for (let again = 0; again < 2; again++) {
      const t = await token(connId, apiKey, again > 0);
      const r = await call('GET', path, { headers: { Authorization: `Bearer ${t}` }, max });
      if ((r.status === 401 || r.status === 403) && again === 0) { tokens.delete(connId); continue; }
      if (r.status < 200 || r.status >= 300) throw explain(r, null, stepOf(path));
      return r;
    }
    throw explain({ status: 401 });
  }

  const sportOf = a => {
    const k = String(a?.activityType?.typeKey || '');
    return SPORT_KEYS.run.test(k) ? 'run' : SPORT_KEYS.bike.test(k) ? 'bike' : null;
  };

  return {
    id: 'garmin',
    kind: 'apikey',
    category: 'import',
    events: [],
    env: [],
    configured: () => true,
    max: 1,
    rate: { capacity: 60, refillMs: 1000 },
    connRate: { capacity: 60, refillMs: 1000 },

    /** The key goes in sealed; nothing is shown back. It is checked by the first test or pull. */
    connect(input) {
      const key = String(input?.apiKey || '').trim();
      if (key.length < 16 || key.length > 512 || /\s/.test(key)) throw fail(400, 'key', 'That does not look like a Garmin API key.');
      return { label: 'Garmin Connect', events: [], info: {}, secrets: { apiKey: key } };
    },
    update(input) { return input?.paused != null ? { paused: input.paused === true } : {}; },

    /** "Test": a token and one activity. Answers in the outbox's words. */
    async deliver(job, reveal) {
      const apiKey = reveal('apiKey');
      if (!apiKey) return { ok: false, retry: false, code: 'sealed', msg: 'Its settings cannot be read any more. Add it again.' };
      const started = Date.now();
      try {
        await get(job.conn, apiKey, '/activitylist-service/activities/search/activities?start=0&limit=1', 1_000_000);
        return { ok: true, status: 200, ms: Date.now() - started };
      } catch (e) { return { ok: false, retry: false, status: e.status, code: e.code || 'garmin', msg: e.message, ms: Date.now() - started }; }
    },

    /**
     * The pull operations the app asks for (hub.pull):
     *   list  { start, limit }   the newest activities that are a run or a ride, as small summaries
     *   file  { activity }       the original file of one activity: { name, data (base64) }
     */
    async pull(op, params, reveal, connId) {
      const apiKey = reveal('apiKey');
      if (!apiKey) throw fail(409, 'sealed', 'Its settings cannot be read any more. Add it again.');
      if (op === 'list') {
        const start = Math.max(0, Math.min(5000, parseInt(params?.start, 10) || 0));
        const limit = Math.max(1, Math.min(LIST_MAX, parseInt(params?.limit, 10) || 50));
        const r = await get(connId, apiKey, `/activitylist-service/activities/search/activities?start=${start}&limit=${limit}&sortOrder=desc`, 5_000_000);
        let arr;
        try { arr = JSON.parse(r.body.toString('utf8')); } catch { arr = null; }
        if (!Array.isArray(arr)) throw fail(502, 'garmin', 'Garmin sent a list openGym cannot read.');
        const items = arr.map(a => ({
          id: String(a?.activityId ?? ''), sport: sportOf(a), name: typeof a?.activityName === 'string' ? a.activityName.slice(0, 80) : '',
          start: Number.isFinite(a?.beginTimestamp) ? a.beginTimestamp : Date.parse(String(a?.startTimeGMT || '').replace(' ', 'T') + 'Z') || null,
          distM: Number.isFinite(a?.distance) ? Math.round(a.distance) : null, sec: Number.isFinite(a?.duration) ? Math.round(a.duration) : null,
        })).filter(a => /^\d{1,20}$/.test(a.id) && a.sport && a.start);
        // `more`: the page was full, so there may be older ones (the app stops at what it knows).
        return { items, more: arr.length >= limit, next: start + arr.length };
      }
      if (op === 'file') {
        const id = String(params?.activity ?? '');
        if (!/^\d{1,20}$/.test(id)) throw fail(400, 'activity', 'That is not an activity id.');
        const r = await get(connId, apiKey, `/download-service/files/activity/${id}`, FILE_MAX);
        const entry = firstEntry(r.body);
        if (!entry) throw fail(502, 'file', 'Garmin sent a file openGym cannot unpack.');
        return { name: entry.name.split('/').pop().slice(0, 80), data: entry.data.toString('base64') };
      }
      throw fail(400, 'op', 'Unknown request.');
    },
    forget(connId) { tokens.delete(connId); },
  };
}
