// Seam 1 helper: reads back a PDF the fake printer received, so a test can say what lies where on each sheet.
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream } from "@cantoo/pdf-lib"

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
}

export interface RenderedSheet {
  width: number
  height: number
  items: RenderedItem[]
}

const round = (n: number) => Math.round(n * 100) / 100 + 0
const number = "(-?[\\d.]+(?:e-?\\d+)?)"
const drawn = new RegExp(`q\\s+${number} ${number} ${number} ${number} re\\s+W\\s+n\\s+${number} ${number} ${number} ${number} ${number} ${number} cm\\s+/(\\S+) Do\\s+Q`, "g")

/** The sheets of a rendered PDF with everything drawn on them, in drawing order. Numbers are rounded to 0.01 pt. */
export async function readRenderedPdf(bytes: Uint8Array): Promise<RenderedSheet[]> {
  const doc = await PDFDocument.load(bytes)
  return doc.getPages().map(page => {
    const sheet = page.getSize()
    const contents = page.node.Contents()
    const streams = contents instanceof PDFArray ? contents.asArray().map(ref => doc.context.lookup(ref)) : contents ? [contents] : []
    const text = streams.map(stream => Buffer.from(decodePDFRawStream(stream as PDFRawStream).decode()).toString("latin1")).join("\n")
    const xobjects = page.node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict)

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
        ...(isPhoto ? { filter: object.dict.get(PDFName.of("Filter"))?.toString(), bytes: object.contents } : {}),
      }
    })
    return { width: round(sheet.width), height: round(sheet.height), items }
  })
}
