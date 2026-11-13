// A file that cannot be read as an activity. `code` is one of: 'empty' (no usable track points),
// 'format' (not GPX, TCX or FIT), 'zip' (a zip, which has to be unpacked first), 'gz' (the
// browser cannot unpack it), 'nodistance' (no distance and no positions to measure one from).
export class CardioError extends Error {
  constructor(code, message) { super(message || code); this.code = code }
}
