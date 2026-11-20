// Small files and values for tests. Keep them deterministic: no dates, no random ids.
import { crc32, deflateSync } from "node:zlib"
import sharp from "sharp"
import type { Item, PrintOptions } from "../../shared/print-options.ts"

/** Valid Print Options for the one page of `samplePdf()`: what a new PDF starts with. */
export const samplePrintOptions: PrintOptions = {
  copies: 1, color: "mono", paper: "A4", quality: "normal",
  printSize: { kind: "fit" }, position: "center", layout: { kind: "grid", perSheet: 1 }, items: [{ count: 1, turn: 0 }],
}

/** One item per page or photo of the draft, in its order: how often each prints. None is turned. */
export const items = (...counts: number[]): Item[] => counts.map(count => ({ count, turn: 0 }))

/**
 * A valid one-page A4 PDF. The second line holds bytes above 0x7f, so a test notices
 * if the file is ever treated as text on its way to the printer.
 */
export function samplePdf(): Uint8Array<ArrayBuffer> {
  return pdfWithPages([{ size: [595, 842] }])
}

function buildPdf(objects: string[]): Uint8Array<ArrayBuffer> {
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n"), Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])]
  let length = chunks[0]!.length + chunks[1]!.length
  const offsets: number[] = []
  for (const [i, body] of objects.entries()) {
    offsets.push(length)
    const chunk = Buffer.from(`${i + 1} 0 obj\n${body}\nendobj\n`)
    chunks.push(chunk)
    length += chunk.length
  }
  const xref = offsets.map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("")
  chunks.push(Buffer.from(
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${xref}` +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`,
  ))
  return new Uint8Array(Buffer.concat(chunks))
}

export interface PdfPageSpec {
  /** MediaBox width and height in points. */
  size: [number, number]
  /** `/Rotate`: clockwise degrees a reader turns the page by when it shows it. Readers take quarter turns only. */
  rotate?: number
  /** `/CropBox` as [left, bottom, right, top]. */
  cropBox?: [number, number, number, number]
  /** A page without `/Contents`: valid, and what a blank page often looks like. */
  blank?: true
  /** Form fields and annotations on the page. */
  annotations?: PdfAnnotationSpec[]
}

/** A form field's widget, or an annotation such as a stamp or a highlight. */
export interface PdfAnnotationSpec {
  /** The annotation's dictionary without `/Type` and `/AP`, for example `/Subtype /Stamp /Rect [10 10 60 30] /F 4`. An entry `/FT` makes it a form field. */
  entries: string
  /** The normal appearance: one, or one per appearance state (`/AS` in `entries` names the state that shows). */
  appearance?: PdfAppearanceSpec | Record<string, PdfAppearanceSpec>
}

export interface PdfAppearanceSpec {
  /** `/BBox` as [left, bottom, right, top]. */
  bbox: [number, number, number, number]
  /** `/Matrix`. */
  matrix?: [number, number, number, number, number, number]
  /** The content stream. */
  content: string
}

/**
 * A valid PDF with the given pages. Each shows one small square, unless it is `blank`.
 * `needAppearances` is the form's `/NeedAppearances`: a reader then draws the fields' values itself.
 */
export function pdfWithPages(pages: PdfPageSpec[], form: { needAppearances?: true } = {}): Uint8Array<ArrayBuffer> {
  const kids = pages.map((_, i) => `${i + 3} 0 R`).join(" ")
  const square = "0 0 10 10 re f"
  // the annotations and their appearances come after the content stream
  const more: string[] = []
  const add = (body: string) => `${pages.length + 3 + more.push(body)} 0 R`
  const stream = ({ bbox, matrix, content }: PdfAppearanceSpec) => add(
    `<< /Type /XObject /Subtype /Form /BBox [${bbox.join(" ")}]${matrix ? ` /Matrix [${matrix.join(" ")}]` : ""} /Length ${content.length} >>\nstream\n${content}\nendstream`,
  )
  const fields: string[] = []
  const annots = pages.map(page => (page.annotations ?? []).map(({ entries, appearance }) => {
    const normal =
      appearance === undefined ? undefined
      : "content" in appearance ? stream(appearance as PdfAppearanceSpec)
      : `<< ${Object.entries(appearance).map(([state, of]) => `/${state} ${stream(of)}`).join(" ")} >>`
    const ref = add(`<< /Type /Annot ${entries}${normal === undefined ? "" : ` /AP << /N ${normal} >>`} >>`)
    if (entries.includes("/FT")) fields.push(ref)
    return ref
  }))
  const acroForm = fields.length === 0 ? "" : ` /AcroForm << /Fields [${fields.join(" ")}]${form.needAppearances ? " /NeedAppearances true" : ""} /DA (/Helv 12 Tf 0 g) >>`
  return buildPdf([
    `<< /Type /Catalog /Pages 2 0 R${acroForm} >>`,
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
    ...pages.map((page, i) =>
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.size[0]} ${page.size[1]}]` +
      (page.rotate === undefined ? "" : ` /Rotate ${page.rotate}`) +
      (page.cropBox === undefined ? "" : ` /CropBox [${page.cropBox.join(" ")}]`) +
      (page.blank ? "" : ` /Contents ${pages.length + 3} 0 R`) +
      (annots[i]!.length === 0 ? "" : ` /Annots [${annots[i]!.join(" ")}]`) +
      " >>"),
    `<< /Length ${square.length} >>\nstream\n${square}\nendstream`,
    ...more,
  ])
}

/** A PDF that asks for a password to open (`userPassword`), or opens without one (owner password only). */
export async function encryptedPdf(passwords: { userPassword: string; ownerPassword: string }): Promise<Uint8Array<ArrayBuffer>> {
  // the one fixture that is not byte-stable: pdf-lib picks a random file id for the encryption key
  const { PDFDocument } = await import("@cantoo/pdf-lib")
  const doc = await PDFDocument.create()
  doc.addPage([100, 100]).drawRectangle({ x: 0, y: 0, width: 10, height: 10 })
  doc.encrypt({ ...passwords, permissions: { printing: "highResolution" } })
  return new Uint8Array(await doc.save())
}

/** A 40×30 px JPEG without EXIF data. */
export function sampleJpeg(): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(sampleJpegBase64, "base64"))
}

/** The JPEG with an EXIF segment that carries only Orientation = `orientation` (1 to 8), right after the SOI marker. */
export function withExifOrientation(jpeg: Uint8Array, orientation: number): Uint8Array<ArrayBuffer> {
  const tiff = Buffer.from([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // "MM", 42, IFD0 at 8
    0x00, 0x01, // 1 entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, // tag 0x0112 SHORT count 1
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ])
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff])
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload])
  return new Uint8Array(Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]))
}

/** A valid single-colour RGB PNG of the given pixel size. */
export function samplePng(width: number, height: number): Uint8Array<ArrayBuffer> {
  return pngWithPixels(Array.from({ length: height }, () => Array.from({ length: width }, () => [200, 30, 30])))
}

/** A baseline JPEG with these pixels, row by row from the top, each as [red, green, blue]. */
export async function jpegWithPixels(rows: number[][][]): Promise<Uint8Array<ArrayBuffer>> {
  const [width, height] = [rows[0]!.length, rows.length]
  const raw = Buffer.from(rows.flat(2))
  return new Uint8Array(await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toBuffer())
}

/** A valid RGB PNG with these pixels, row by row from the top, each as [red, green, blue]. */
export function pngWithPixels(rows: number[][][]): Uint8Array<ArrayBuffer> {
  const [width, height] = [rows[0]!.length, rows.length]
  const raw = Buffer.alloc((width * 3 + 1) * height)
  rows.forEach((row, y) => row.forEach((pixel, x) => raw.set(pixel, y * (width * 3 + 1) + 1 + x * 3)))
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, "latin1"), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.set([8, 2, 0, 0, 0], 8)
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]))
}

/** The first bytes of an iPhone HEIC photo: an ISO media file of brand `heic`. */
export function heicHeader(): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from("\0\0\0\x18ftypheic\0\0\0\0mif1heic", "latin1"))
}

/** The first bytes of a Word document (.docx is a ZIP archive). */
export function docxHeader(): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from("PK\x03\x04\x14\0\x06\0\x08\0\0\0!\0[Content_Types].xml", "latin1"))
}

const sampleJpegBase64 =
  "/9j/4AAQSkZJRgABAQAASABIAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs" +
  "+EJ+/8AAEQgAHgAoAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAAB" +
  "fQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpj" +
  "ZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn" +
  "6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUh" +
  "MQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpz" +
  "dHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX2" +
  "9/j5+v/bAEMABAQEBAQEBgQEBgkGBgYJDAkJCQkMDwwMDAwMDxIPDw8PDw8SEhISEhISEhUVFRUVFRkZGRkZHBwcHBwcHBwcHP/b" +
  "AEMBBAUFBwcHDAcHDB0UEBQdHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHf/dAAQAA//a" +
  "AAwDAQACEQMRAD8A8hooor4U/qoKKKKACiiigD//0PIaKKK+FP6qCiiigAooooA//9k="
