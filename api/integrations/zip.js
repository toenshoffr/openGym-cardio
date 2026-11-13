/* Reads one file out of a zip held in memory, with node:zlib and nothing else. Garmin's activity
 * download (GET /download-service/files/activity/{id}) is a zip with the original FIT inside,
 * deflated, which is why this reads the central directory and inflates, unlike the store-only zip
 * the app writes for its own backups.
 *
 * Refused (null): no match, encryption, a method other than stored (0) or deflate (8), a
 * truncated archive, ZIP64, and anything that would unpack past `maxOut` bytes. A zip bomb cannot
 * get past the size the directory declares, nor past the inflate limit. */
import zlib from 'node:zlib';

export const MAX_OUT = 25 * 1024 * 1024;

/** The first entry whose name matches `pick` (a RegExp), as { name, data } or null. */
export function firstEntry(buf, pick = /\.(fit|gpx|tcx)$/i, maxOut = MAX_OUT) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) return null;
  // The end-of-central-directory record is within the last 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && n < 1000; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null;
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (!pick.test(name) || name.endsWith('/')) continue;
    if ((flags & 1) || (method !== 0 && method !== 8) || usize > maxOut || csize === 0xffffffff || usize === 0xffffffff) return null;
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) return null;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (start + csize > buf.length) return null;
    const raw = buf.subarray(start, start + csize);
    try {
      const data = method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw, { maxOutputLength: maxOut });
      return data.length <= maxOut ? { name, data } : null;
    } catch { return null; }
  }
  return null;
}
