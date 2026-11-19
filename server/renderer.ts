import {
  PDFDocument, clip, concatTransformationMatrix, drawObject, endPath, popGraphicsState, pushGraphicsState, rectangle,
  type PDFRef,
} from "@cantoo/pdf-lib"
import { readFile } from "node:fs/promises"
import { Readable } from "node:stream"
import sharp from "sharp"
import type { Margins, PhotoFacts } from "../shared/api.ts"
import { SHEET_SIZES, layout, photoNaturalSize, sheetCount, type LayoutInput, type Matrix, type Placement, type Sheet } from "../shared/layout.ts"
import type { PrintOptions } from "../shared/print-options.ts"
import type { Engine } from "./dell-engine.ts"
import type { DraftFile } from "./intake.ts"
import { DOT, RASTERS, type HbplEncoder } from "./printer/hbpl.ts"
import { drawAnnotations, openSourcePdf, shownPart } from "./source-pdf.ts"

/** What goes to CUPS: a PDF for the queue's driver, or HBPL, the Printer's own language, which CUPS passes on as it is. */
export interface PrintDocument { format: "pdf" | "hbpl"; bytes: Uint8Array }

export type RenderResult =
  /** `sheets` is the sheets of paper the Print Job takes: the sheets in `document`, for every copy. */
  | { outcome: "rendered"; document: PrintDocument; sheets: number }
  /** The Print Options don't fit the draft's files. */
  | { outcome: "invalid-options" }

/** Dell's engine from the share folder, and what packs its raster into HBPL. */
export interface DellPrinting { engine: Engine; encode: HbplEncoder }

/** Something to draw: an embedded page or photo, and the step from it to the content the layout module placed. */
type Drawable = { ref: PDFRef; toContent: Matrix }

/**
 * How a render reports how far it has got and is stopped. `onProgress` comes once the layout is known, with 0, and after
 * every finished sheet; `sheets` counts the sheets the render builds, which for HBPL includes the copies. Aborting
 * `signal` stops the render with the signal's reason.
 */
export interface RenderWatch {
  onProgress?: (sheetsDone: number, sheets: number) => void
  signal?: AbortSignal
}

/**
 * The renderer: builds what goes to the Printer from a draft's files and the Print Options.
 * Where everything sits comes from the layout module; `margins` are the Printer's for the chosen paper.
 * With `dell`, colour photos become HBPL through Dell's engine; everything else is a PDF.
 *
 * The Print Options are invalid when the selection is empty, when it names a page or photo the draft
 * doesn't have, or when photos are to go two per sheet.
 */
export async function render(
  files: readonly DraftFile[], options: PrintOptions, margins: Margins, dell?: DellPrinting, watch: RenderWatch = {},
): Promise<RenderResult> {
  const facts = files[0]?.facts
  if (!facts) return { outcome: "invalid-options" }
  const { selection } = options
  // pages are counted from 1, photos from 0
  const firstRef = facts.kind === "pdf" ? 1 : 0
  const count = facts.kind === "pdf" ? facts.pages.length : files.length
  const valid =
    selection.length > 0 &&
    selection.every(ref => ref >= firstRef && ref < firstRef + count) &&
    (facts.kind === "pdf" || options.pagesPerSheet === 1)
  if (!valid) return { outcome: "invalid-options" }

  const photos = facts.kind === "pdf" ? [] : files.map(file => file.facts as PhotoFacts)
  const source: LayoutInput["source"] = facts.kind === "pdf" ? facts : { kind: "photos", photos }
  const sheet = SHEET_SIZES[options.paper]
  const sheets = layout({ source, options, sheet, margins })
  const sheetsOfJob = sheetCount(sheets, options.copies)
  if (source.kind === "photos" && options.color === "color" && dell) {
    watch.onProgress?.(0, sheets.length * options.copies)
    const bytes = await dell.encode(options.paper, Readable.from(dellRaster(files, sheets, options, dell.engine, watch)))
    return { outcome: "rendered", document: { format: "hbpl", bytes }, sheets: sheetsOfJob }
  }

  // CUPS makes the copies of a PDF
  watch.onProgress?.(0, sheets.length)
  const out = await PDFDocument.create()
  const chosen = [...new Set(selection)]
  let drawables = new Map<number, Drawable>()
  if (source.kind === "pdf") {
    drawables = await embedPages(out, await readFile(files[0]!.path), chosen)
  } else {
    // one after the other: pdf-lib unpacks a PNG to raw pixels, and 20 of those at once need too much memory
    for (const index of chosen) {
      watch.signal?.throwIfAborted()
      const bytes = await readFile(files[index]!.path)
      const photo = photos[index]!
      const image = photo.format === "jpeg" ? await out.embedJpg(bytes) : await out.embedPng(bytes)
      // an image is drawn as the unit square
      const { width, height } = photoNaturalSize(photo)
      drawables.set(index, { ref: image.ref, toContent: [width, 0, 0, height, 0, 0] })
    }
  }

  for (const [done, { placements }] of sheets.entries()) {
    watch.signal?.throwIfAborted()
    const page = out.addPage([sheet.width, sheet.height])
    for (const placement of placements) {
      const drawable = drawables.get(placement.ref)
      // a page without content has nothing to draw: its sheet, or its half, stays empty
      if (!drawable) continue
      const { clip: area } = placement
      page.pushOperators(
        pushGraphicsState(),
        rectangle(area.left, sheet.height - area.top - area.height, area.width, area.height),
        clip(),
        endPath(),
        concatTransformationMatrix(...after(placement.matrix, drawable.toContent)),
        drawObject(page.node.newXObject("X", drawable.ref)),
        popGraphicsState(),
      )
    }
    watch.onProgress?.(done + 1, sheets.length)
  }
  return { outcome: "rendered", document: { format: "pdf", bytes: await out.save() }, sheets: sheetsOfJob }
}

/** Rows of the Printer's raster per chunk of the stream to foo2hbpl2. */
const ROWS_PER_CHUNK = 64

/**
 * The sheets of a colour photo job as the Printer's raster through Dell's engine: the full raster of the paper per
 * sheet, the sheets in order and then again for each further copy. A dot is a photo's when its centre lies in the
 * part of the sheet where the photo shows.
 */
async function* dellRaster(files: readonly DraftFile[], sheets: Sheet[], options: PrintOptions, engine: Engine, watch: RenderWatch): AsyncGenerator<Uint8Array> {
  const { width, height } = RASTERS[options.paper]
  const sheetHeight = SHEET_SIZES[options.paper].height
  let done = 0
  for (let copy = 0; copy < options.copies; copy++) {
    for (const { placements } of sheets) {
      const shown = []
      for (const placement of placements) {
        const photo = await photoSampler(files[placement.ref]!, placement, sheetHeight)
        if (!photo) continue
        const x0 = Math.max(0, Math.round(photo.box.left / DOT)), x1 = Math.min(width, Math.round(photo.box.right / DOT))
        const y0 = Math.max(0, Math.round(photo.box.top / DOT)), y1 = Math.min(height, Math.round(photo.box.bottom / DOT))
        if (x1 > x0 && y1 > y0) shown.push({ photo, x0, x1, y0, y1, rgb: new Uint8Array((x1 - x0) * 3) })
      }
      for (let top = 0; top < height; top += ROWS_PER_CHUNK) {
        watch.signal?.throwIfAborted()
        const chunk = new Uint8Array(Math.min(ROWS_PER_CHUNK, height - top) * width)
        for (let y = top; y < top + chunk.length / width; y++) {
          const row = chunk.subarray((y - top) * width, (y - top + 1) * width)
          for (const { photo, x0, x1, y0, y1, rgb } of shown) {
            if (y < y0 || y >= y1) continue
            for (let x = x0; x < x1; x++) {
              // off the stored pixels, at a rounded edge, is paper
              if (!photo.colour((x + 0.5) * DOT, (y + 0.5) * DOT, rgb, (x - x0) * 3)) rgb.fill(255, (x - x0) * 3, (x - x0) * 3 + 3)
            }
            engine.dots(y, x0, rgb, row)
          }
        }
        yield chunk
        // a sheet takes seconds: between chunks the server answers other requests
        await new Promise(resolve => setImmediate(resolve))
      }
      watch.onProgress?.(++done, sheets.length * options.copies)
    }
  }
}

/**
 * A photo as its placement shows it: `box`, the part of the sheet where it shows (its box cut to its clip, in points
 * from the sheet's top left), and its colour at a point there, from the stored pixels scaled to about one per dot.
 * Undefined when nothing of the photo shows.
 */
async function photoSampler(file: DraftFile, placement: Placement, sheetHeight: number) {
  const { clip: area } = placement
  const box = {
    left: Math.max(placement.left, area.left),
    top: Math.max(placement.top, area.top),
    right: Math.min(placement.left + placement.width, area.left + area.width),
    bottom: Math.min(placement.top + placement.height, area.top + area.height),
  }
  if (box.right <= box.left || box.bottom <= box.top) return undefined

  const natural = photoNaturalSize(file.facts as PhotoFacts)
  const pixelsWide = Math.max(1, Math.round((natural.width * placement.scale) / DOT))
  const pixelsHigh = Math.max(1, Math.round((natural.height * placement.scale) / DOT))
  const { data } = await sharp(await readFile(file.path))
    .resize(pixelsWide, pixelsHigh, { fit: "fill", kernel: "lanczos3" })
    // a transparent part prints as the paper, as pdf-lib's PNG soft mask does
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true })

  // from a point on the sheet back into the stored photo, through the inverse of the matrix that draws it
  const [a, b, c, d, e, f] = after(placement.matrix, [natural.width, 0, 0, natural.height, 0, 0])
  const determinant = a * d - b * c
  return {
    box,
    /** Writes the sRGB colour at `x`, `y` (points from the sheet's top left) into `out` at `at`; false off the stored pixels. */
    colour(x: number, y: number, out: Uint8Array, at: number): boolean {
      const px = x - e, py = sheetHeight - y - f
      // u runs along the stored rows, v up the stored columns, both 0 … 1 across the photo
      const u = (d * px - c * py) / determinant
      const v = (a * py - b * px) / determinant
      const column = Math.floor(u * pixelsWide)
      const line = Math.floor((1 - v) * pixelsHigh)
      if (column < 0 || column >= pixelsWide || line < 0 || line >= pixelsHigh) return false
      const i = (line * pixelsWide + column) * 3
      out[at] = data[i]!
      out[at + 1] = data[i + 1]!
      out[at + 2] = data[i + 2]!
      return true
    },
  }
}

/**
 * Embeds the pages (numbers counted from 1) as reusable objects. pdf-lib embeds the MediaBox and ignores the
 * page's own rotation; a reader shows a part of the page, turned. So that part is embedded and the turn is added here.
 * Only a page's content is embedded, so its form fields and annotations are drawn into the content first.
 * A page that has no content even then is not in the result: pdf-lib can't embed it.
 */
async function embedPages(out: PDFDocument, bytes: Uint8Array, pageNumbers: number[]): Promise<Map<number, Drawable>> {
  const doc = await openSourcePdf(bytes)
  await drawAnnotations(doc, pageNumbers.map(number => doc.getPage(number - 1)))
  const withContent = pageNumbers.filter(number => doc.getPage(number - 1).node.Contents() !== undefined)
  const pages = withContent.map(number => doc.getPage(number - 1))
  const shown = pages.map(shownPart)
  const embedded = await out.embedPages(pages, shown.map(part => part.box))
  return new Map(withContent.map((number, i) => {
    const { width, height } = embedded[i]!
    const turns: Record<0 | 90 | 180 | 270, Matrix> = {
      0: [1, 0, 0, 1, 0, 0],
      90: [0, -1, 1, 0, 0, width],
      180: [-1, 0, 0, -1, width, height],
      270: [0, 1, -1, 0, height, 0],
    }
    return [number, { ref: embedded[i]!.ref, toContent: turns[shown[i]!.rotation] }]
  }))
}

/** `second` applied after `first`. */
function after(second: Matrix, first: Matrix): Matrix {
  const [a, b, c, d, e, f] = second
  const [p, q, r, s, t, u] = first
  // + 0 turns -0 into 0
  return [a * p + c * q + 0, b * p + d * q + 0, a * r + c * s + 0, b * r + d * s + 0, a * t + c * u + e, b * t + d * u + f]
}
