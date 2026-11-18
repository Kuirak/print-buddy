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

export type Sheet = { placements: Placement[] }

export function layout({ source, options, sheet, margins }: LayoutInput): Sheet[] {
  const ref = options.selection[0]!
  const natural = source.pages[ref - 1]!
  const printable = { width: sheet.width - margins.left - margins.right, height: sheet.height - margins.top - margins.bottom }
  const { printSize } = options
  const scale =
    printSize.kind === "fit" ? Math.min(printable.width / natural.width, printable.height / natural.height)
    : printSize.kind === "fill" ? Math.max(sheet.width / natural.width, sheet.height / natural.height)
    : printSize.value / 100
  const width = natural.width * scale
  const height = natural.height * scale
  const left = margins.left + (printable.width - width) / 2
  const top = margins.top + (printable.height - height) / 2
  return [
    {
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
    },
  ]
}
