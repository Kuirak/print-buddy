// The layout module: where content sits on a sheet. The browser preview and the server renderer both
// call `layout`, so the printout matches the preview. Keep this file free of DOM and Node imports.

import type { PrintOptions } from "./print-options.ts"

/** In points (1/72 inch). */
export type Size = { width: number; height: number }

/** Widths of the strips along the sheet's edges the Printer can't print on, in points. */
export type Margins = { top: number; right: number; bottom: number; left: number }

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

export type LayoutInput = {
  source: { kind: "pdf"; pages: Size[] }
  options: Pick<PrintOptions, "printSize" | "position" | "pagesPerSheet" | "rotation" | "selection" | "photoRotations">
  sheet: Size
  margins: Margins
}

export type Placement = Box & {
  ref: number
  rotation: 0 | 90 | 180 | 270
  scale: number
  matrix: Matrix
  clip: Box
}

export type Sheet = {
  placements: Placement[]
  /** Part of the content lies outside the printable area and won't print. */
  cutOff: boolean
  /** Part of the printable area stays empty. */
  emptySpace: boolean
}

/** Sizes closer than this, in points, count as equal: Einpassen must not report a cut-off from rounding. */
const TOLERANCE = 0.01

/** How far along the printable area each Position sits: 0 is the left or top edge, 1 the right or bottom edge. */
const ANCHORS: Record<PrintOptions["position"], [across: number, down: number]> = {
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

export function layout({ source, options, sheet, margins }: LayoutInput): Sheet[] {
  const printable = { width: sheet.width - margins.left - margins.right, height: sheet.height - margins.top - margins.bottom }
  const { printSize } = options
  const [alignX, alignY] = ANCHORS[options.position]
  return options.selection.map(ref => {
    const natural = source.pages[ref - 1]!
    const scale =
      printSize.kind === "fit" ? Math.min(printable.width / natural.width, printable.height / natural.height)
      : printSize.kind === "fill" ? Math.max(sheet.width / natural.width, sheet.height / natural.height)
      : printSize.value / 100
    const width = natural.width * scale
    const height = natural.height * scale
    const left = margins.left + (printable.width - width) * alignX
    const top = margins.top + (printable.height - height) * alignY
    return {
      placements: [
        {
          ref,
          rotation: 0,
          scale,
          left,
          top,
          width,
          height,
          matrix: [scale, 0, 0, scale, left, sheet.height - top - height],
          clip: { left: 0, top: 0, width: sheet.width, height: sheet.height },
        },
      ],
      cutOff: width > printable.width + TOLERANCE || height > printable.height + TOLERANCE,
      emptySpace: width < printable.width - TOLERANCE || height < printable.height - TOLERANCE,
    }
  })
}
