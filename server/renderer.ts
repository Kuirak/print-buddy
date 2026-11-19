import {
  PDFDocument, clip, concatTransformationMatrix, drawObject, endPath, popGraphicsState, pushGraphicsState, rectangle,
  type PDFRef,
} from "@cantoo/pdf-lib"
import { readFile } from "node:fs/promises"
import type { Margins, PhotoFacts } from "../shared/api.ts"
import { SHEET_SIZES, layout, photoNaturalSize, sheetCount, type LayoutInput, type Matrix } from "../shared/layout.ts"
import type { PrintOptions } from "../shared/print-options.ts"
import type { DraftFile } from "./intake.ts"
import { drawAnnotations, openSourcePdf, shownPart } from "./source-pdf.ts"

export type RenderResult =
  /** `sheets` is the sheets of paper the Print Job takes: the sheets in `pdf`, for every copy. */
  | { outcome: "rendered"; pdf: Uint8Array; sheets: number }
  /** The Print Options don't fit the draft's files. */
  | { outcome: "invalid-options" }

/** Something to draw: an embedded page or photo, and the step from it to the content the layout module placed. */
type Drawable = { ref: PDFRef; toContent: Matrix }

/**
 * The renderer: builds the PDF that goes to the Printer from a draft's files and the Print Options.
 * Where everything sits comes from the layout module; `margins` are the Printer's for the chosen paper.
 *
 * The Print Options are invalid when the selection is empty, when it names a page or photo the draft
 * doesn't have, or when photos are to go two per sheet.
 */
export async function render(files: readonly DraftFile[], options: PrintOptions, margins: Margins): Promise<RenderResult> {
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

  const out = await PDFDocument.create()
  const chosen = [...new Set(selection)]
  let source: LayoutInput["source"]
  let drawables: Map<number, Drawable>
  if (facts.kind === "pdf") {
    source = facts
    drawables = await embedPages(out, await readFile(files[0]!.path), chosen)
  } else {
    const photos = files.map(file => file.facts as PhotoFacts)
    source = { kind: "photos", photos }
    drawables = new Map()
    // one after the other: pdf-lib unpacks a PNG to raw pixels, and 20 of those at once need too much memory
    for (const index of chosen) {
      const bytes = await readFile(files[index]!.path)
      const photo = photos[index]!
      const image = photo.format === "jpeg" ? await out.embedJpg(bytes) : await out.embedPng(bytes)
      // an image is drawn as the unit square
      const { width, height } = photoNaturalSize(photo)
      drawables.set(index, { ref: image.ref, toContent: [width, 0, 0, height, 0, 0] })
    }
  }

  const sheet = SHEET_SIZES[options.paper]
  const sheets = layout({ source, options, sheet, margins })
  for (const { placements } of sheets) {
    const page = out.addPage([sheet.width, sheet.height])
    for (const placement of placements) {
      // a page without content has nothing to draw: its sheet, or its half, stays empty
      const drawable = drawables.get(placement.ref)
      if (!drawable) continue
      const { ref, toContent } = drawable
      const { clip: area } = placement
      page.pushOperators(
        pushGraphicsState(),
        rectangle(area.left, sheet.height - area.top - area.height, area.width, area.height),
        clip(),
        endPath(),
        concatTransformationMatrix(...after(placement.matrix, toContent)),
        drawObject(page.node.newXObject("X", ref)),
        popGraphicsState(),
      )
    }
  }
  return { outcome: "rendered", pdf: await out.save(), sheets: sheetCount(sheets, options.copies) }
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
