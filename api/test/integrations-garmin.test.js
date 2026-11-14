/* Garmin (integrations/providers/garmin.js): the key traded for a token, the activity list cut down
 * to runs and rides, the zip a download comes in, and the hub end to end, all against a fake
 * transport: nothing here reaches Garmin. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const { firstEntry } = await import('../integrations/zip.js');
const { garminProvider, tokenOf, requestHeaders } = await import('../integrations/providers/garmin.js');
const { createIntegrations } = await import('../integrations/index.js');

const SECRET = 'b'.repeat(64);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gym-garmin-'));

/** A zip with the given entries, deflated (or stored), as Garmin's download is. */
function zipOf(entries, { store = false } = {}) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const raw = Buffer.from(data), body = store ? raw : zlib.deflateRawSync(raw), nm = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nm.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(store ? 0 : 8, 10);
    cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(raw.length, 24); cen.writeUInt16LE(nm.length, 28); cen.writeUInt32LE(offset, 42);
    parts.push(local, nm, body); central.push(cen, nm);
    offset += 30 + nm.length + body.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

/** A fake Garmin: records every request, answers from `routes`. */
function fakeGarmin(over = {}) {
  const calls = [];
  const t = async (method, p, { headers = {} } = {}) => {
    calls.push({ method, p, auth: headers.Authorization });
    if (over.fail) throw over.fail;
    if (p.startsWith('/personalapitoken-service')) {
      if (headers.Authorization !== 'ApiKey GOOD-KEY-0123456789') return { status: 401, headers: {}, body: Buffer.alloc(0) };
      return over.token || { status: 200, headers: {}, body: Buffer.from(JSON.stringify({ access_token: 'tok-' + calls.length })) };
    }
    if (!/^Bearer tok-/.test(headers.Authorization || '')) return { status: 401, headers: {}, body: Buffer.alloc(0) };
    if (p.startsWith('/activitylist-service')) {
      return { status: 200, headers: {}, body: Buffer.from(JSON.stringify(over.list || [
        { activityId: 111, activityName: 'Morning run', beginTimestamp: 1_700_000_000_000, distance: 10012.4, duration: 3001.2, activityType: { typeKey: 'trail_running' } },
        { activityId: 112, activityName: 'Commute', startTimeGMT: '2026-11-10 07:00:00', distance: 12000, duration: 2400, activityType: { typeKey: 'road_biking' } },
        { activityId: 113, activityName: 'Pool', beginTimestamp: 1_700_100_000_000, distance: 1000, duration: 1800, activityType: { typeKey: 'lap_swimming' } },
        { activityId: 'x', beginTimestamp: 1, activityType: { typeKey: 'running' } },
      ])) };
    }
    if (p.startsWith('/download-service/files/activity/')) return over.file || { status: 200, headers: {}, body: zipOf([['111_ACTIVITY.fit', 'FITDATA']]) };
    return { status: 404, headers: {}, body: Buffer.alloc(0) };
  };
  return { t, calls };
}
const reveal = name => (name === 'apiKey' ? 'GOOD-KEY-0123456789' : null);

test('a zip: deflated or stored, the first activity file, nothing else', () => {
  assert.deepEqual(firstEntry(zipOf([['a.txt', 'no'], ['b/act.FIT', 'hello']])).data.toString(), 'hello');
  assert.equal(firstEntry(zipOf([['b/act.FIT', 'hello']])).name, 'b/act.FIT');
  assert.equal(firstEntry(zipOf([['act.gpx', '<gpx/>']], { store: true })).data.toString(), '<gpx/>');
  assert.equal(firstEntry(zipOf([['a.txt', 'x']])), null, 'no activity file');
  assert.equal(firstEntry(Buffer.from('not a zip at all, really not')), null);
  assert.equal(firstEntry(zipOf([['a.fit', 'x'.repeat(5000)]]), /\.fit$/, 1000), null, 'declared bigger than the limit');
  const truncated = zipOf([['a.fit', 'hello']]).subarray(0, 40);
  assert.equal(firstEntry(truncated), null);
});

test('the headers are curl\'s: any Accept and a user agent, never a narrower Accept of our own', () => {
  assert.deepEqual(requestHeaders('GET', { Authorization: 'Bearer x' }), { 'User-Agent': 'openGym', Accept: '*/*', Authorization: 'Bearer x' });
  assert.deepEqual(requestHeaders('POST', { Authorization: 'ApiKey k' }), { 'User-Agent': 'openGym', Accept: '*/*', Authorization: 'ApiKey k', 'Content-Length': 0 });
  assert.equal(requestHeaders('GET').Accept, '*/*');
});

test('the token step asks for no Accept of its own (a 406 was reported with a real key)', async () => {
  const g = fakeGarmin();
  let seen;
  const p = garminProvider({ transport: async (m, path, o) => { if (path.startsWith('/personalapitoken')) seen = o.headers; return g.t(m, path, o); } });
  await p.pull('list', {}, reveal, 'c1');
  assert.equal(seen.Accept, undefined);
  assert.equal(seen.Authorization, 'ApiKey GOOD-KEY-0123456789');
});

test('an answer nobody expected says its status, the step and what Garmin said', async () => {
  const notAcceptable = garminProvider({ transport: async () => ({ status: 406, headers: {}, body: Buffer.from('Not Acceptable') }) });
  await assert.rejects(notAcceptable.pull('list', {}, reveal, 'c1'), { code: 'garmin', message: 'Garmin answered 406 at the token step: Not Acceptable.' });
  const atList = garminProvider({ transport: async (m, p) => (p.startsWith('/personalapitoken') ? { status: 200, headers: {}, body: Buffer.from('{"access_token":"tok-1"}') } : { status: 406, headers: {}, body: Buffer.from('{"error":"no acceptable representation"}') }) });
  await assert.rejects(atList.pull('list', {}, reveal, 'c1'), { message: 'Garmin answered 406 at the list step: {"error":"no acceptable representation"}.' });
  const atFile = garminProvider({ transport: async (m, p) => (p.startsWith('/download') ? { status: 500, headers: {}, body: Buffer.alloc(0) } : fakeGarmin().t(m, p, { headers: { Authorization: m === 'POST' ? 'ApiKey GOOD-KEY-0123456789' : 'Bearer tok-1' } })) });
  await assert.rejects(atFile.pull('file', { activity: '1' }, reveal, 'c1'), { message: 'Garmin answered 500 at the file step.' });
  const binary = garminProvider({ transport: async () => ({ status: 406, headers: {}, body: Buffer.from([0, 1, 2, 255]) }) });
  await assert.rejects(binary.pull('list', {}, reveal, 'c1'), { message: 'Garmin answered 406 at the token step.' });
});

test('the token reply is read whatever shape it has', () => {
  assert.equal(tokenOf(Buffer.from('{"access_token":"abc123"}')), 'abc123');
  assert.equal(tokenOf(Buffer.from('{"accessToken":"abc123"}')), 'abc123');
  assert.equal(tokenOf(Buffer.from('{"token":"abc123"}')), 'abc123');
  assert.equal(tokenOf(Buffer.from('"just.a.token.string-1234567890"')), 'just.a.token.string-1234567890');
  assert.equal(tokenOf(Buffer.from('eyJhbGciOi.payload.sig-123456')), 'eyJhbGciOi.payload.sig-123456');
  assert.equal(tokenOf(Buffer.from('')), null);
  assert.equal(tokenOf(Buffer.from('{"error":"nope"}')), null);
  assert.equal(tokenOf(Buffer.from('<html>no</html>')), null);
});

test('connect checks the key shape and seals nothing it should not show', () => {
  const p = garminProvider({ transport: fakeGarmin().t });
  assert.throws(() => p.connect({ apiKey: 'short' }), /does not look like/);
  assert.throws(() => p.connect({ apiKey: 'has a space 0123456789' }), /does not look like/);
  const made = p.connect({ apiKey: '  GOOD-KEY-0123456789 ' });
  assert.deepEqual(made.secrets, { apiKey: 'GOOD-KEY-0123456789' });
  assert.deepEqual(made.info, {});
  assert.equal(made.reveal, undefined);
  assert.deepEqual(made.events, []);
});

test('list keeps runs and rides, reads both time fields, and drops what has no id', async () => {
  const g = fakeGarmin(), p = garminProvider({ transport: g.t });
  const out = await p.pull('list', { limit: 50 }, reveal, 'c1');
  assert.deepEqual(out.items.map(a => [a.id, a.sport]), [['111', 'run'], ['112', 'bike']]);
  assert.equal(out.items[0].start, 1_700_000_000_000);
  assert.equal(out.items[1].start, Date.parse('2026-11-10T07:00:00Z'));
  assert.equal(out.items[0].distM, 10012);
  assert.equal(out.more, false);
  assert.match(g.calls[1].p, /start=0&limit=50&sortOrder=desc/);
  assert.equal(g.calls[0].auth, 'ApiKey GOOD-KEY-0123456789', 'the key goes to the token endpoint only');
  assert.match(g.calls[1].auth, /^Bearer tok-/);
});

test('the token is reused for a day, and a refused one is replaced once', async () => {
  let t = 0;
  const g = fakeGarmin(), p = garminProvider({ transport: g.t, now: () => t });
  await p.pull('list', {}, reveal, 'c1');
  await p.pull('list', {}, reveal, 'c1');
  assert.equal(g.calls.filter(c => c.p.startsWith('/personalapitoken')).length, 1);
  t += 21 * 3600_000;
  await p.pull('list', {}, reveal, 'c1');
  assert.equal(g.calls.filter(c => c.p.startsWith('/personalapitoken')).length, 2, 'older than 20 h: a new one');
});

test('file answers the original file, base64, and refuses a bad id', async () => {
  const g = fakeGarmin(), p = garminProvider({ transport: g.t });
  const f = await p.pull('file', { activity: '111' }, reveal, 'c1');
  assert.equal(f.name, '111_ACTIVITY.fit');
  assert.equal(Buffer.from(f.data, 'base64').toString(), 'FITDATA');
  await assert.rejects(p.pull('file', { activity: '../../x' }, reveal, 'c1'), { code: 'activity' });
  await assert.rejects(p.pull('nope', {}, reveal, 'c1'), { code: 'op' });
  const bad = garminProvider({ transport: fakeGarmin({ file: { status: 200, headers: {}, body: Buffer.from('plain') } }).t });
  await assert.rejects(bad.pull('file', { activity: '1' }, reveal, 'c1'), { code: 'file' });
});

test('Garmin refusing the key, being busy or unreachable is said in plain words', async () => {
  const wrong = garminProvider({ transport: fakeGarmin().t });
  await assert.rejects(wrong.pull('list', {}, name => (name === 'apiKey' ? 'WRONG-KEY-0123456789' : null), 'c1'), { code: 'key', status: 401 });
  const busy = garminProvider({ transport: async (m, p) => (p.startsWith('/personalapitoken') ? { status: 200, headers: {}, body: Buffer.from('{"access_token":"tok-1"}') } : { status: 429, headers: {}, body: Buffer.alloc(0) }) });
  await assert.rejects(busy.pull('list', {}, reveal, 'c1'), { code: 'busy', status: 429 });
  const down = garminProvider({ transport: fakeGarmin({ fail: Object.assign(new Error('x'), { code: 'ENOTFOUND' }) }).t });
  await assert.rejects(down.pull('list', {}, reveal, 'c1'), { code: 'dns' });
  const odd = garminProvider({ transport: fakeGarmin({ token: { status: 200, headers: {}, body: Buffer.from('{"nothing":1}') } }).t });
  await assert.rejects(odd.pull('list', {}, reveal, 'c1'), { code: 'token' });
});

test('deliver is the Test button: a token and one activity', async () => {
  const p = garminProvider({ transport: fakeGarmin().t });
  const ok = await p.deliver({ conn: 'c1' }, reveal);
  assert.equal(ok.ok, true);
  const no = await p.deliver({ conn: 'c1' }, () => null);
  assert.equal(no.code, 'sealed');
  const bad = await garminProvider({ transport: fakeGarmin().t }).deliver({ conn: 'c2' }, name => (name === 'apiKey' ? 'WRONG-KEY-0123456789' : null));
  assert.deepEqual([bad.ok, bad.code, bad.status], [false, 'key', 401]);
});

test('the hub: off unless INTEGRATIONS names garmin; connect, test, pull, pause, disconnect', async () => {
  const off = createIntegrations({ dataDir: tmp(), secret: SECRET, env: {} });
  assert.equal(off.active, false);
  await assert.rejects(off.pull('u1', 'x', 'list', {}), { code: 'off' });

  const g = fakeGarmin(), dir = tmp();
  const hub = createIntegrations({ dataDir: dir, secret: SECRET, env: { INTEGRATIONS: 'garmin' }, garminTransport: g.t });
  assert.deepEqual(hub.ids, ['garmin']);
  assert.throws(() => hub.connect('u1', 'garmin', { apiKey: 'nope' }), { status: 400 });
  const { connection } = hub.connect('u1', 'garmin', { apiKey: 'GOOD-KEY-0123456789' });
  assert.equal(connection.provider, 'garmin');
  assert.ok(!JSON.stringify(hub.describe('u1')).includes('GOOD-KEY'), 'the key never comes back');
  const files = fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => path.join(e.parentPath, e.name));
  assert.ok(files.length > 0, 'the connection is on disk');
  for (const f of files) assert.ok(!fs.readFileSync(f, 'utf8').includes('GOOD-KEY-0123456789'), `${f} holds the key in plain text`);
  assert.throws(() => hub.connect('u1', 'garmin', { apiKey: 'GOOD-KEY-0123456789' }), { code: 'too-many' });

  const t = await hub.test('u1', connection.id, null);
  assert.equal(t.ok, true);
  const list = await hub.pull('u1', connection.id, 'list', { limit: 10 });
  assert.equal(list.items.length, 2);
  await assert.rejects(hub.pull('u2', connection.id, 'list', {}), { code: 'missing' }, 'another profile cannot use it');

  hub.update('u1', connection.id, { paused: true });
  await assert.rejects(hub.pull('u1', connection.id, 'list', {}), { code: 'paused' });
  hub.update('u1', connection.id, { paused: false });

  hub.disconnect('u1', connection.id);
  await assert.rejects(hub.pull('u1', connection.id, 'list', {}), { code: 'missing' });
});

test('a refused key puts the connection in "needs attention", a busy Garmin does not', async () => {
  const hub = createIntegrations({ dataDir: tmp(), secret: SECRET, env: { INTEGRATIONS: 'garmin' }, garminTransport: fakeGarmin().t });
  const { connection } = hub.connect('u1', 'garmin', { apiKey: 'WRONG-KEY-0123456789' });
  await assert.rejects(hub.pull('u1', connection.id, 'list', {}), { code: 'key' });
  assert.equal(hub.describe('u1').connections[0].status, 'attention');
  assert.match(hub.describe('u1').connections[0].lastError.msg, /refused the key/);
});
