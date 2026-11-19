// The layout module: where content sits on a sheet. The browser preview and the server renderer both
// call `layout`, so the printout matches the preview. Keep this file free of DOM and Node imports.

import type { Margins } from "./api.ts"
import type { PrintOptions, Rotation } from "./print-options.ts"

/** In points (1/72 inch). */
export type Size = { width: number; height: number }

/** A rectangle on the sheet in points, measured from the sheet's top-left corner. */
export type Box = { left: number; top: number; width: number; height: number }

/** A PDF transformation matrix `[a b c d e f]`: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = [number, number, number, number, number, number]

const POINTS_PER_MM = 72 / 25.4

/** The papers as the Printer feeds them: portrait, envelopes too (their PPD sizes are 110 × 220 and 162 × 229 mm). */
export const SHEET_SIZES: Record<PrintOptions["paper"], Size> = {
  A4: { width: 210 * POINTS_PER_MM, height: 297 * POINTS_PER_MM },
  A5: { width: 148 * POINTS_PER_MM, height: 210 * POINTS_PER_MM },
  EnvDL: { width: 110 * POINTS_PER_MM, height: 220 * POINTS_PER_MM },
  EnvC5: { width: 162 * POINTS_PER_MM, height: 229 * POINTS_PER_MM },
}

/** A photo's natural size in points: its pixels at 300 dpi. */
export function photoNaturalSize(pixels: Size): Size {
  return { width: (pixels.width * 72) / 300, height: (pixels.height * 72) / 300 }
}

/** A photo as stored in its file: pixels, before its EXIF orientation is applied. */
type Photo = { width: number; height: number; orientation: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 }

export type LayoutInput = {
  /**
   * A PDF's pages with the sizes a reader shows, in points. Or the photos of a Print Job.
   * `options.selection` holds page numbers counted from 1, or photo indexes counted from 0.
   */
  source: { kind: "pdf"; pages: Size[] } | { kind: "photos"; photos: Photo[] }
  options: Pick<PrintOptions, "printSize" | "position" | "pagesPerSheet" | "rotation" | "selection" | "photoRotations">
  sheet: Size
  margins: Margins
}

/** One page or photo on a sheet. The box is the space it takes up there, after turning and scaling. */
export type Placement = Box & {
  /** The PDF page number or the photo index, as in the selection. */
  ref: number
  /** Clockwise turn of the upright content: auto-rotate plus manual rotation. A photo's EXIF orientation is not part of it. */
  rotation: Rotation
  /** 1 is the natural size. */
  scale: number
  /**
   * For drawing into a PDF: maps the content as stored (its natural size in points, origin at the lower left,
   * a photo before its EXIF orientation) onto the sheet (origin at the lower left, y counts upwards).
   */
  matrix: Matrix
  /** The part of the sheet this placement may draw on. Whatever falls outside is not drawn. */
  clip: Box
}

export type Sheet = {
  /** One per page or photo on this sheet. With two pages per sheet and an odd number of pages, the last sheet has one. */
  placements: Placement[]
  /** Part of the content lies outside the printable area and won't print. */
  cutOff: boolean
  /** Part of the printable area stays empty. */
  emptySpace: boolean
  /**
   * The sheet is read turned a quarter: two pages per sheet on a portrait sheet. The pages lie on it turned 90°
   * clockwise, the first in the top half. Turn the sheet 90° counter-clockwise to see them upright and side by side.
   */
  sideways: boolean
}

/** Sizes closer than this, in points, count as equal: Einpassen must not report a cut-off from rounding. */
const TOLERANCE = 0.01

/** How far along the printable area each Position sits: 0 is the left or top edge, 1 the right or bottom edge. */
const POSITIONS: Record<PrintOptions["position"], [across: number, down: number]> = {
  "top-left": [0, 0],
  top: [0.5, 0],
  "top-right": [1, 0],
  left: [0, 0.5],
  center: [0.5, 0.5],
  right: [1, 0.5],
  "bottom-left": [0, 1],
  bottom: [0.5, 1],
  "bottom-right": [1, 1],
}

/** The linear part `[a b c d]` of a matrix: a turn or a mirroring, without the shift. */
type Linear = [number, number, number, number]

/** Clockwise turns, in PDF coordinates (y counts upwards). */
const TURNS: Record<Rotation, Linear> = {
  0: [1, 0, 0, 1],
  90: [0, -1, 1, 0],
  180: [-1, 0, 0, -1],
  270: [0, 1, -1, 0],
}

/** What brings a photo stored with each EXIF orientation upright: a turn, a mirroring, or both. */
const ORIENTATIONS: Record<Photo["orientation"], Linear> = {
  1: [1, 0, 0, 1],
  2: [-1, 0, 0, 1],
  3: [-1, 0, 0, -1],
  4: [1, 0, 0, -1],
  5: [0, -1, -1, 0],
  6: [0, -1, 1, 0],
  7: [0, 1, 1, 0],
  8: [0, 1, -1, 0],
}

/** `second` applied after `first`. */
function compose(second: Linear, first: Linear): Linear {
  const [a, b, c, d] = second
  const [p, q, r, s] = first
  return [a * p + c * q, b * p + d * q, a * r + c * s, b * r + d * s]
}

/**
 * The matrix that turns and scales content of its natural size, then shifts it so that the lower-left
 * corner of its bounding box lands on (`x`, `y`), in PDF coordinates.
 */
function matrixFor(linear: Linear, natural: Size, scale: number, x: number, y: number): Matrix {
  const [a, b, c, d] = linear.map(n => n * scale + 0) as Linear
  const minX = Math.min(0, a * natural.width) + Math.min(0, c * natural.height)
  const minY = Math.min(0, b * natural.width) + Math.min(0, d * natural.height)
  return [a, b, c, d, x - minX, y - minY]
}

/** One page or photo of the selection, before it meets a sheet. */
type Content = {
  ref: number
  /** As stored, in points. */
  natural: Size
  orientation: Photo["orientation"]
  /** After the EXIF orientation. */
  upright: Size
  autoRotate: boolean
  manualRotation: Rotation
}

/** The part of a sheet that takes one page or photo: the whole sheet, or one half of it. */
type Area = { whole: Box; printable: Box }

/**
 * Where each selected page or photo sits, sheet by sheet. Every entry of the selection must exist in the source.
 *
 * - Rotation: EXIF orientation first, then auto-rotate (photos only, at Einpassen and Füllen: a landscape photo on a
 *   portrait sheet turns 90°, and the reverse), then manual rotation. All turns are clockwise.
 * - Einpassen is the largest size inside the printable area, Füllen the smallest that covers the whole sheet,
 *   a percentage scales from the natural size.
 * - Position aligns the content to the printable area.
 * - Two pages per sheet (PDFs only; photos get one sheet each): the sheet is read in landscape and split into a left
 *   and a right half, each laid out as its own sheet. A portrait sheet is therefore `sideways`.
 */
export function layout({ source, options, sheet, margins }: LayoutInput): Sheet[] {
  const contents = options.selection.map((ref): Content => {
    if (source.kind === "pdf") {
      const natural = source.pages[ref - 1]!
      return { ref, natural, orientation: 1, upright: natural, autoRotate: false, manualRotation: options.rotation }
    }
    const photo = source.photos[ref]!
    const natural = photoNaturalSize(photo)
    return {
      ref,
      natural,
      orientation: photo.orientation,
      upright: photo.orientation <= 4 ? natural : flipped(natural),
      autoRotate: options.printSize.kind !== "percent",
      manualRotation: options.photoRotations?.[ref] ?? 0,
    }
  })

  // Everything is laid out the way the sheet is read, and only then put onto the sheet the way the Printer feeds it.
  const twoPerSheet = source.kind === "pdf" && options.pagesPerSheet === 2
  const sideways = twoPerSheet && sheet.height > sheet.width
  const view = sideways ? flipped(sheet) : sheet
  const edge = sideways ? { top: margins.right, right: margins.bottom, bottom: margins.left, left: margins.top } : margins
  const printableHeight = view.height - edge.top - edge.bottom
  const half = view.width / 2
  const areas: Area[] =
    twoPerSheet ?
      [
        {
          whole: { left: 0, top: 0, width: half, height: view.height },
          printable: { left: edge.left, top: edge.top, width: half - edge.left, height: printableHeight },
        },
        {
          whole: { left: half, top: 0, width: half, height: view.height },
          printable: { left: half, top: edge.top, width: half - edge.right, height: printableHeight },
        },
      ]
    : [
        {
          whole: { left: 0, top: 0, ...view },
          printable: { left: edge.left, top: edge.top, width: view.width - edge.left - edge.right, height: printableHeight },
        },
      ]
  const onSheet = (box: Box): Box =>
    sideways ? { left: sheet.width - box.top - box.height, top: box.left, width: box.height, height: box.width } : box

  const [across, down] = POSITIONS[options.position]
  const sheets: Sheet[] = []
  for (let first = 0; first < contents.length; first += areas.length) {
    const onThisSheet = contents.slice(first, first + areas.length)
    const result: Sheet = { placements: [], cutOff: false, emptySpace: onThisSheet.length < areas.length, sideways }
    onThisSheet.forEach((content, index) => {
      const { whole, printable } = areas[index]!
      const { upright } = content
      // A landscape photo on a portrait sheet, or the reverse. Squares stay.
      const liesAcross = (upright.width - upright.height) * (whole.width - whole.height) < 0
      const viewRotation = ((content.autoRotate && liesAcross ? 90 : 0) + content.manualRotation) % 360
      const turned = viewRotation % 180 === 0 ? upright : flipped(upright)
      const { printSize } = options
      const scale =
        printSize.kind === "fit" ? Math.min(printable.width / turned.width, printable.height / turned.height)
        : printSize.kind === "fill" ? Math.max(whole.width / turned.width, whole.height / turned.height)
        : printSize.value / 100
      const width = turned.width * scale
      const height = turned.height * scale
      const box = onSheet({
        left: printable.left + (printable.width - width) * across,
        top: printable.top + (printable.height - height) * down,
        width,
        height,
      })
      const rotation = ((viewRotation + (sideways ? 90 : 0)) % 360) as Rotation
      result.placements.push({
        ref: content.ref,
        rotation,
        scale,
        ...box,
        matrix: matrixFor(
          compose(TURNS[rotation], ORIENTATIONS[content.orientation]),
          content.natural,
          scale,
          box.left,
          sheet.height - box.top - box.height,
        ),
        clip: onSheet(whole),
      })
      result.cutOff ||= width > printable.width + TOLERANCE || height > printable.height + TOLERANCE
      result.emptySpace ||= width < printable.width - TOLERANCE || height < printable.height - TOLERANCE
    })
    sheets.push(result)
  }
  return sheets
}

/**
 * How many sheets of paper a Print Job takes: the sheets of one copy, as `layout` returns them, for every copy.
 * The confirmation and the server's record of the Print Job both count here, so they can't say different numbers.
 */
export function sheetCount(sheets: readonly Sheet[], copies: number): number {
  return sheets.length * copies
}

function flipped({ width, height }: Size): Size {
  return { width: height, height: width }
}
