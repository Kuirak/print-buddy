// Seam 1 helper: reads back a PDF the fake printer received, so a test can say what lies where on each sheet.
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream, type PDFPage } from "@cantoo/pdf-lib"

type Matrix = [number, number, number, number, number, number]

/** A rectangle on the sheet in points, measured from the sheet's top-left corner, as the layout module does. */
export interface Box { left: number; top: number; width: number; height: number }

/** One page or photo drawn on a sheet. */
export interface RenderedItem {
  kind: "page" | "photo"
  /**
   * What tells the items of a test apart. For a page: the width and height of the part of the source page
   * that was embedded, before the page's own `/Rotate`. For a photo: its pixel width and height.
   */
  size: [number, number]
  /** The space the item takes up on the sheet. */
  box: Box
  /** The part of the sheet the item is clipped to. */
  clip: Box
  /**
   * Where the item's corners land on the sheet, as [left, top] each, in the order bottom-left, bottom-right,
   * top-left, top-right of the stored content. They show rotation and mirroring.
   */
  corners: [number, number][]
  /** A photo's stream filter (`/DCTDecode` for a JPEG) and stream bytes. */
  filter?: string
  bytes?: Uint8Array
  /**
   * A page's form fields and annotations that were drawn into it, in drawing order: the rectangle each takes up
   * on the source page as [left, bottom, right, top], and the content stream of its appearance. Absent when there are none.
   */
  annotations?: { rect: [number, number, number, number]; content: string }[]
}

export interface RenderedSheet {
  width: number
  height: number
  items: RenderedItem[]
}

const round = (n: number) => Math.round(n * 100) / 100 + 0
const number = "(-?[\\d.]+(?:e-?\\d+)?)"
const drawn = new RegExp(`q\\s+${number} ${number} ${number} ${number} re\\s+W\\s+n\\s+${number} ${number} ${number} ${number} ${number} ${number} cm\\s+/(\\S+) Do\\s+Q`, "g")
const placed = new RegExp(`q\\s+${number} ${number} ${number} ${number} ${number} ${number} cm\\s+/(\\S+) Do\\s+Q`, "g")
const outlined = new RegExp(`q\\s+${number} w\\s+${number} G\\s+${number} ${number} ${number} ${number} re\\s+S\\s+Q`, "g")

/** The form fields and annotations drawn into an embedded page, as `RenderedItem.annotations`. */
function annotationsOf(page: PDFRawStream): Pick<RenderedItem, "annotations"> {
  const text = Buffer.from(decodePDFRawStream(page).decode()).toString("latin1")
  const xobjects = page.dict.lookup(PDFName.of("Resources"), PDFDict).lookupMaybe(PDFName.of("XObject"), PDFDict)
  const annotations = [...text.matchAll(placed)].map(match => {
    const appearance = xobjects!.lookup(PDFName.of(match[7]!)) as PDFRawStream
    const numbers = (key: string) => appearance.dict.lookupMaybe(PDFName.of(key), PDFArray)?.asArray().map(n => (n as PDFNumber).asNumber())
    const [x0, y0, x1, y1] = numbers("BBox") as [number, number, number, number]
    // the appearance's own matrix first, then the one it was drawn with
    const matrices = [numbers("Matrix") ?? [1, 0, 0, 1, 0, 0], match.slice(1, 7).map(Number)] as Matrix[]
    const points = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(corner =>
      matrices.reduce(([x, y], [a, b, c, d, e, f]) => [a * x! + c * y! + e, b * x! + d * y! + f], corner))
    const xs = points.map(p => p[0]!)
    const ys = points.map(p => p[1]!)
    return {
      rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(round) as [number, number, number, number],
      content: Buffer.from(decodePDFRawStream(appearance).decode()).toString("latin1"),
    }
  })
  return annotations.length > 0 ? { annotations } : {}
}

/** A sheet's content stream as text, and the objects it can draw by name. */
function contentOf(doc: PDFDocument, page: PDFPage) {
  const contents = page.node.Contents()
  const streams = contents instanceof PDFArray ? contents.asArray().map(ref => doc.context.lookup(ref)) : contents ? [contents] : []
  const text = streams.map(stream => Buffer.from(decodePDFRawStream(stream as PDFRawStream).decode()).toString("latin1")).join("\n")
  return { text, xobjects: page.node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict) }
}

/** The sheets of a rendered PDF with everything drawn on them, in drawing order. Numbers are rounded to 0.01 pt. */
export async function readRenderedPdf(bytes: Uint8Array): Promise<RenderedSheet[]> {
  const doc = await PDFDocument.load(bytes)
  return doc.getPages().map(page => {
    const sheet = page.getSize()
    const { text, xobjects } = contentOf(doc, page)

    const items = [...text.matchAll(drawn)].map((match): RenderedItem => {
      const [clipX, clipY, clipWidth, clipHeight, ...matrix] = match.slice(1, 11).map(Number) as [number, number, number, number, ...Matrix]
      const object = xobjects!.lookup(PDFName.of(match[11]!)) as PDFRawStream
      const numbers = (key: string) => object.dict.lookup(PDFName.of(key), PDFArray).asArray().map(n => (n as PDFNumber).asNumber())
      const isPhoto = object.dict.lookup(PDFName.of("Subtype"), PDFName) === PDFName.of("Image")
      // an image is the unit square; an embedded page spans its BBox
      const [x0, y0, x1, y1] = isPhoto ? [0, 0, 1, 1] : numbers("BBox") as [number, number, number, number]
      // the form's own matrix moves the BBox to the origin
      const [width, height] = [x1 - x0, y1 - y0]
      const points = [[0, 0], [width, 0], [0, height], [width, height]].map(([x, y]): [number, number] => [
        matrix[0] * x! + matrix[2] * y! + matrix[4],
        matrix[1] * x! + matrix[3] * y! + matrix[5],
      ])
      const xs = points.map(p => p[0])
      const ys = points.map(p => p[1])
      return {
        kind: isPhoto ? "photo" : "page",
        size: isPhoto
          ? [object.dict.lookup(PDFName.of("Width"), PDFNumber).asNumber(), object.dict.lookup(PDFName.of("Height"), PDFNumber).asNumber()]
          : [width, height],
        box: {
          left: round(Math.min(...xs)),
          top: round(sheet.height - Math.max(...ys)),
          width: round(Math.max(...xs) - Math.min(...xs)),
          height: round(Math.max(...ys) - Math.min(...ys)),
        },
        clip: { left: round(clipX), top: round(sheet.height - clipY - clipHeight), width: round(clipWidth), height: round(clipHeight) },
        corners: points.map(([x, y]): [number, number] => [round(x), round(sheet.height - y)]),
        ...(isPhoto ? { filter: object.dict.get(PDFName.of("Filter"))?.toString(), bytes: object.contents } : annotationsOf(object)),
      }
    })
    return { width: round(sheet.width), height: round(sheet.height), items }
  })
}

/** How many stored objects the sheets of a rendered PDF draw: a page or photo stored once counts once, however often it is drawn. */
export async function drawnObjects(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes)
  const stored = new Set<string>()
  for (const page of doc.getPages()) {
    const { text, xobjects } = contentOf(doc, page)
    for (const match of text.matchAll(drawn)) stored.add(String(xobjects!.get(PDFName.of(match[11]!))))
  }
  return stored.size
}

/** The rectangles stroked on each sheet, with the width and the grey (0 black, 1 white) of their line. Numbers rounded to 0.01 pt. */
export async function strokedBoxes(bytes: Uint8Array): Promise<{ box: Box; width: number; grey: number }[][]> {
  const doc = await PDFDocument.load(bytes)
  return doc.getPages().map(page => {
    const { height } = page.getSize()
    return [...contentOf(doc, page).text.matchAll(outlined)].map(match => {
      const [width, grey, x, y, w, h] = match.slice(1, 7).map(Number) as [number, number, number, number, number, number]
      return { box: { left: round(x), top: round(height - y - h), width: round(w), height: round(h) }, width, grey }
    })
  })
}
