// Minimal IPP/1.1 binary codec (RFC 8010), checked against a real cupsd 2.4.10.
// Used by the Printer client and by the fake IPP printer in tests.
export const Tag = {
  operation: 0x01, job: 0x02, end: 0x03, printer: 0x04, unsupported: 0x05,
  unsupportedValue: 0x10, unknown: 0x12, noValue: 0x13,
  integer: 0x21, boolean: 0x22, enum: 0x23,
  octetString: 0x30, dateTime: 0x31, resolution: 0x32, rangeOfInteger: 0x33,
  begCollection: 0x34, textWithLanguage: 0x35, nameWithLanguage: 0x36, endCollection: 0x37,
  text: 0x41, name: 0x42, keyword: 0x44, uri: 0x45, uriScheme: 0x46, charset: 0x47, naturalLanguage: 0x48, mimeMediaType: 0x49,
  memberAttrName: 0x4a,
} as const

export const Op = { printJob: 0x0002, cancelJob: 0x0008, getJobAttributes: 0x0009, getPrinterAttributes: 0x000b } as const
export const Status = { ok: 0x0000, badRequest: 0x0400, forbidden: 0x0401, notAuthenticated: 0x0402, notAuthorized: 0x0403, notPossible: 0x0404, notFound: 0x0406, operationNotSupported: 0x0501, notAcceptingJobs: 0x0506 } as const
export const JobState = { pending: 3, held: 4, processing: 5, stopped: 6, canceled: 7, aborted: 8, completed: 9 } as const
export const PrinterState = { idle: 3, processing: 4, stopped: 5 } as const

export type IppCollection = { [member: string]: IppValue[] }
type IppScalar = number | boolean | string | null | [number, number] | [number, number, number] | Uint8Array | IppCollection
interface IppValue { tag: number; value: IppScalar }
export interface IppAttribute { name: string; values: IppValue[] }
export interface IppGroup { tag: number; attributes: IppAttribute[] }
export interface IppMessage {
  version: [number, number]
  /** operation-id (request) or status-code (response) */
  code: number
  requestId: number
  groups: IppGroup[]
  /** document bytes after end-of-attributes (may be empty) */
  data: Uint8Array
}

// value constructors
export const v = {
  int: (n: number): IppValue => ({ tag: Tag.integer, value: n }),
  enum: (n: number): IppValue => ({ tag: Tag.enum, value: n }),
  bool: (b: boolean): IppValue => ({ tag: Tag.boolean, value: b }),
  keyword: (s: string): IppValue => ({ tag: Tag.keyword, value: s }),
  name: (s: string): IppValue => ({ tag: Tag.name, value: s }),
  text: (s: string): IppValue => ({ tag: Tag.text, value: s }),
  uri: (s: string): IppValue => ({ tag: Tag.uri, value: s }),
  charset: (s: string): IppValue => ({ tag: Tag.charset, value: s }),
  lang: (s: string): IppValue => ({ tag: Tag.naturalLanguage, value: s }),
  mime: (s: string): IppValue => ({ tag: Tag.mimeMediaType, value: s }),
  col: (c: IppCollection): IppValue => ({ tag: Tag.begCollection, value: c }),
}
export const attr = (name: string, ...values: IppValue[]): IppAttribute => ({ name, values })

const enc = new TextEncoder()
const dec = new TextDecoder()

export function encodeIpp(msg: IppMessage): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = []
  const u8 = (n: number) => parts.push(Uint8Array.of(n))
  const u16 = (n: number) => parts.push(Uint8Array.of(n >> 8, n & 0xff))
  const i32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, n); parts.push(b) }
  const bytes = (b: Uint8Array) => { u16(b.length); parts.push(b) }
  const str = (s: string) => bytes(enc.encode(s))

  const value = (val: IppValue) => {
    const { tag, value: x } = val
    if (tag === Tag.integer || tag === Tag.enum) { u16(4); i32(x as number) }
    else if (tag === Tag.boolean) { u16(1); u8(x ? 1 : 0) }
    else if (tag === Tag.rangeOfInteger) { u16(8); i32((x as number[])[0]!); i32((x as number[])[1]!) }
    else if (tag === Tag.resolution) { u16(9); i32((x as number[])[0]!); i32((x as number[])[1]!); u8((x as number[])[2]!) }
    else if (tag === Tag.begCollection) {
      u16(0)
      for (const [member, values] of Object.entries(x as IppCollection)) {
        u8(Tag.memberAttrName); u16(0); str(member)
        for (const mv of values) { u8(mv.tag); u16(0); value(mv) }
      }
      u8(Tag.endCollection); u16(0); u16(0)
    }
    else if (x === null) u16(0) // out-of-band (no-value, unknown, ...)
    else if (x instanceof Uint8Array) bytes(x) // octetString, dateTime raw
    else if (typeof x === "string") str(x)
    else throw new Error(`ipp: cannot encode tag 0x${tag.toString(16)}`)
  }

  u8(msg.version[0]); u8(msg.version[1]); u16(msg.code); i32(msg.requestId)
  for (const g of msg.groups) {
    u8(g.tag)
    for (const a of g.attributes) {
      a.values.forEach((val, i) => { u8(val.tag); if (i === 0) str(a.name); else u16(0); value(val) })
    }
  }
  u8(Tag.end)
  parts.push(msg.data)
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return out
}

export function decodeIpp(buf: Uint8Array): IppMessage {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let pos = 0
  const need = (n: number) => { if (pos + n > buf.length) throw new Error("ipp: truncated message") }
  const u8 = () => { need(1); return buf[pos++]! }
  const u16 = () => { need(2); const n = view.getUint16(pos); pos += 2; return n }
  const i32 = () => { need(4); const n = view.getInt32(pos); pos += 4; return n }
  const take = (n: number) => { need(n); const b = buf.subarray(pos, pos + n); pos += n; return b }

  const scalar = (tag: number, raw: Uint8Array): IppScalar => {
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
    if (tag >= 0x10 && tag <= 0x1f) return null
    if (tag === Tag.integer || tag === Tag.enum) return dv.getInt32(0)
    if (tag === Tag.boolean) return raw[0] !== 0
    if (tag === Tag.rangeOfInteger) return [dv.getInt32(0), dv.getInt32(4)]
    if (tag === Tag.resolution) return [dv.getInt32(0), dv.getInt32(4), raw[8]!]
    if (tag === Tag.textWithLanguage || tag === Tag.nameWithLanguage) {
      const langLen = dv.getUint16(0); const textLen = dv.getUint16(2 + langLen)
      return dec.decode(raw.subarray(4 + langLen, 4 + langLen + textLen))
    }
    if (tag === Tag.octetString || tag === Tag.dateTime) return raw.slice()
    return dec.decode(raw)
  }

  // called after the begCollection value was consumed; reads up to and including endCollection
  const collection = (): IppCollection => {
    const col: IppCollection = {}
    let current: IppValue[] | undefined
    for (;;) {
      const tag = u8(); take(u16()); const raw = take(u16())
      if (tag === Tag.endCollection) return col
      if (tag === Tag.memberAttrName) { current = col[dec.decode(raw)] = []; continue }
      if (!current) throw new Error("ipp: collection member value without name")
      current.push({ tag, value: tag === Tag.begCollection ? collection() : scalar(tag, raw) })
    }
  }

  const version: [number, number] = [u8(), u8()]
  const code = u16()
  const requestId = i32()
  const groups: IppGroup[] = []
  let group: IppGroup | undefined
  let last: IppAttribute | undefined
  for (;;) {
    const tag = u8()
    if (tag === Tag.end) break
    if (tag < 0x10) { group = { tag, attributes: [] }; groups.push(group); last = undefined; continue }
    if (!group) throw new Error("ipp: attribute before group tag")
    const name = dec.decode(take(u16()))
    const raw = take(u16())
    const val: IppValue = { tag, value: tag === Tag.begCollection ? collection() : scalar(tag, raw) }
    if (name === "") { if (!last) throw new Error("ipp: additional value without attribute"); last.values.push(val) }
    else { last = { name, values: [val] }; group.attributes.push(last) }
  }
  return { version, code, requestId, groups, data: buf.subarray(pos) }
}

// lookups
export function findAttr(msg: IppMessage, groupTag: number, name: string): IppValue[] | undefined {
  for (const g of msg.groups) if (g.tag === groupTag) for (const a of g.attributes) if (a.name === name) return a.values
  return undefined
}
export const values = (msg: IppMessage, groupTag: number, name: string): IppScalar[] => findAttr(msg, groupTag, name)?.map(x => x.value) ?? []
