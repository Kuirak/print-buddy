// The layout module: where content sits on a sheet. The browser preview and the server renderer both
// call `layout`, so the printout matches the preview. Keep this file free of DOM and Node imports.

import type { Margins } from "./api.ts"
import { photoFormats, type FormatLayout, type Item, type Layout, type PerSheet, type PrintOptions, type PrintSizeMode, type Rotation } from "./print-options.ts"

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
   * `options.items` holds one item per page or photo, in the same order.
   */
  source: { kind: "pdf"; pages: Size[] } | { kind: "photos"; photos: Photo[] }
  options: Pick<PrintOptions, "printSize" | "position" | "layout" | "items">
  sheet: Size
  margins: Margins
}

/** One page or photo on a sheet. The box is the space it takes up there, after turning and scaling. */
export type Placement = Box & {
  /** The PDF page number, counted from 1, or the photo index, counted from 0. */
  ref: number
  /** Clockwise turn of the upright content: auto-rotate plus the item's turn. A photo's EXIF orientation is not part of it. */
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
  /**
   * Panning, as the sheet is read: `x` and `y` are how far along the overlap the content lies, 0 (left or top edge of the
   * printable area flush) to 1 (right or bottom edge flush). `overflowX` and `overflowY` are the points by which it overlaps
   * the printable area on that axis; 0 where it fits, so there is nothing to pan. `rotation` is the clockwise turn of the
   * upright content as read (without the sheet's own): `contentPan` brings a pan made here back to the item's own axes.
   */
  pan: { x: number; y: number; overflowX: number; overflowY: number; rotation: Rotation }
}

export type Sheet = {
  /** One per page or photo on this sheet, in the order of its Cells. A last sheet that isn't full has fewer. */
  placements: Placement[]
  /** Part of the content lies outside the printable area and won't print. */
  cutOff: boolean
  /** Part of the printable area stays empty. */
  emptySpace: boolean
  /**
   * The sheet is read turned a quarter: a grid read in landscape on a portrait sheet (see `cells`). The pages or photos
   * lie on it turned 90° clockwise, the first Cells along the right edge. Turn the sheet 90° counter-clockwise to read it.
   */
  sideways: boolean
  /** At a Photo format with cut lines on: the slots that hold a photo, to be outlined with a hairline. Empty otherwise. */
  cutLines: Box[]
}

/** The gap between the slots of a Photo format when "Abstand zum Schneiden" is on. */
const GAP_MM = 2

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

/** One appearance of a page or photo, before it meets a sheet. */
type Content = {
  ref: number
  /** As stored, in points. */
  natural: Size
  orientation: Photo["orientation"]
  /** After the EXIF orientation. */
  upright: Size
  autoRotate: boolean
  /** The item's turn. */
  turn: Rotation
  /** The item's pan, along the content's own axes. */
  pan: Item["pan"]
  /** The item's size, or else the Print size. */
  printSize: PrintSizeMode
}

/**
 * A Cell (see GLOSSARY.md): the part of a sheet that takes one page or photo. With one per sheet it is the whole sheet.
 * Its boxes are on the sheet as the Printer feeds it.
 */
export type Cell = {
  /** All of it. Füllen covers it, and its page or photo is drawn nowhere else. One per sheet: the whole sheet, the unprintable edge included. */
  box: Box
  /** The part of it the Printer prints on. Einpassen fits into it, and Position aligns to it. */
  printable: Box
}

/** A sheet's Cells in the order they fill. `sideways`: the sheet is read turned a quarter, as `Sheet.sideways` says. */
export type Cells = { cells: Cell[]; sideways: boolean }

/**
 * The grids for portrait pages or photos: columns and rows as the sheet is read, and whether it is read in landscape.
 * Read so, portrait pages stand upright in their Cells.
 */
const GRIDS: Record<PerSheet, { columns: number; rows: number; landscape: boolean }> = {
  1: { columns: 1, rows: 1, landscape: false },
  2: { columns: 2, rows: 1, landscape: true },
  4: { columns: 2, rows: 2, landscape: false },
  6: { columns: 3, rows: 2, landscape: true },
  8: { columns: 2, rows: 4, landscape: false },
}

/**
 * Whether the grids are read the other way: for a PDF whose first printed page is landscape, as a reader shows it.
 * Its own turn doesn't count, so that turning one page never moves the others. Photos turn by themselves instead.
 */
export function landscapeFirst(source: LayoutInput["source"], items: readonly Item[]): boolean {
  if (source.kind !== "pdf") return false
  const first = source.pages[items.findIndex(item => item.count > 0)]
  return first !== undefined && first.width > first.height
}

/**
 * The slots of a Photo format on the sheet, in the order they fill: as many of its size as fit the printable area,
 * `gap` apart, packed from the top left a row at a time. Upright slots for "portrait", sideways ones for "landscape";
 * "save" takes whichever holds the most of: all upright, a block of upright slots with a strip of sideways ones below
 * it, all sideways, or a block of sideways slots with a strip of upright ones below it (the first of those on a tie).
 */
function formatSlots(layout: FormatLayout, sheet: Size, margins: Margins): Box[] {
  const { w, h } = typeof layout.format === "string" ? photoFormats[layout.format] : layout.format
  const short = Math.min(w, h) * POINTS_PER_MM
  const long = Math.max(w, h) * POINTS_PER_MM
  const gap = layout.gap ? GAP_MM * POINTS_PER_MM : 0
  const { width } = printableArea(sheet, margins)
  // slots of `slot` size in rows from `top`, as many as fit down to the printable area's bottom edge
  const block = (top: number, slot: Size): Box[] => {
    const fit = (length: number, size: number) => Math.max(0, Math.floor((length + gap + TOLERANCE) / (size + gap)))
    const columns = fit(width, slot.width)
    const rows = fit(sheet.height - margins.bottom - top, slot.height)
    return Array.from({ length: rows * columns }, (_, i) => ({
      left: margins.left + (i % columns) * (slot.width + gap),
      top: top + Math.floor(i / columns) * (slot.height + gap),
      ...slot,
    }))
  }
  const upright = { width: short, height: long }
  const across = flipped(upright)
  const ways = layout.lage === "portrait" ? [upright] : layout.lage === "landscape" ? [across] : [upright, across]
  const candidates = ways.flatMap(slot => {
    const main = block(margins.top, slot)
    if (layout.lage !== "save" || main.length === 0) return [main]
    const below = Math.max(...main.map(box => box.top + box.height)) + gap
    return [main, [...main, ...block(below, flipped(slot))]]
  })
  return candidates.reduce((best, candidate) => (candidate.length > best.length ? candidate : best), [])
}

/**
 * The Cells a layout divides a sheet into, in the order they fill. `layout` places into them, and the sketch of a
 * layout draws them. No Cells for a layout that can't be laid out on the sheet.
 *
 * - 1 per sheet is the whole sheet; its printable part is the sheet's printable area.
 * - The other grids divide the printable area into equal Cells, filled left to right, then top to bottom, as the sheet
 *   is read: 2 is 2 × 1 read in landscape, 4 is 2 × 2 read in portrait, 6 is 3 × 2 in landscape, 8 is 2 × 4 in portrait.
 *   On a portrait sheet, one read in landscape is `sideways`: turned a quarter counter-clockwise to read, so the first
 *   Cells lie along the sheet's right edge.
 * - `landscape` (see `landscapeFirst`) reads every grid the other way: the same Cells, read turned a quarter, so that
 *   landscape pages stand upright in them. 2 and 6 are then read upright, 4 and 8 sideways.
 * - A Photo format's Cells are its slots (see `formatSlots`), none when the format doesn't fit the paper.
 */
export function cells(layout: Layout, sheet: Size, margins: Margins, landscape = false): Cells {
  if (layout.kind === "format") return { cells: formatSlots(layout, sheet, margins).map(box => ({ box, printable: box })), sideways: false }
  if (layout.perSheet === 1) {
    return { cells: [{ box: { left: 0, top: 0, ...sheet }, printable: printableArea(sheet, margins) }], sideways: false }
  }
  const grid = GRIDS[layout.perSheet]
  const [columns, rows] = landscape ? [grid.rows, grid.columns] : [grid.columns, grid.rows]
  // Everything is divided the way the sheet is read, and only then put onto the sheet the way the Printer feeds it.
  const readInLandscape = grid.landscape !== landscape
  const sideways = readInLandscape !== sheet.width > sheet.height
  const view = sideways ? flipped(sheet) : sheet
  const edge = sideways ? { top: margins.right, right: margins.bottom, bottom: margins.left, left: margins.top } : margins
  const onSheet = (box: Box): Box =>
    sideways ? { left: sheet.width - box.top - box.height, top: box.left, width: box.height, height: box.width } : box
  const width = (view.width - edge.left - edge.right) / columns
  const height = (view.height - edge.top - edge.bottom) / rows
  const result: Cell[] = []
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      // a Cell is all printable: Füllen covers it and no more, so neighbours never overlap
      const box = onSheet({ left: edge.left + column * width, top: edge.top + row * height, width, height })
      result.push({ box, printable: box })
    }
  }
  return { cells: result, sideways }
}

/** The part of the sheet the Printer can print on. */
export function printableArea(sheet: Size, margins: Margins): Box {
  return { left: margins.left, top: margins.top, width: sheet.width - margins.left - margins.right, height: sheet.height - margins.top - margins.bottom }
}

/**
 * Where each page or photo sits, sheet by sheet. Every item with a count above 0 must have its page or photo in the source.
 *
 * - Sequence: the items in the file's order, each as often as its `count` says, next to itself (A A B B).
 *   An item with a count of 0 is left out.
 * - Rotation: EXIF orientation first, then auto-rotate (photos only, at Einpassen and Füllen: a landscape photo on a
 *   portrait sheet turns 90°, and the reverse), then the item's `turn`. All turns are clockwise.
 * - Einpassen is the largest size inside the printable part of the Cell, Füllen the smallest that covers the whole Cell,
 *   a percentage scales from the natural size. An item's `size` replaces the Print size for that item. At a Photo
 *   format a percentage counts as Füllen, and nothing is ever reported as cut off: cropping to the slot is expected.
 * - Position aligns the content to the printable part of its Cell. An item's `pan` replaces it on each axis where the
 *   content overlaps the printable part, and only there. It is given along the content's own axes (see `readPan`), so
 *   a photo turned to a sideways slot shows the same part of itself as in an upright one.
 * - Cells: see `cells`. Each page or photo is laid out in its Cell as on a sheet of its own; photos turn by themselves
 *   to the Cell, PDF pages never do, and the grid is read the other way after a landscape first page instead.
 *   No sheets when the layout can't be laid out.
 */
export function layout({ source, options, sheet, margins }: LayoutInput): Sheet[] {
  const atFormat = options.layout.kind === "format"
  const forAll: PrintSizeMode = atFormat && options.printSize.kind === "percent" ? { kind: "fill" } : options.printSize
  const contents = options.items.flatMap((item, index): Content[] => {
    if (item.count === 0) return []
    const printSize: PrintSizeMode = item.size ? { kind: item.size } : forAll
    let content: Content
    if (source.kind === "pdf") {
      const natural = source.pages[index]!
      content = { ref: index + 1, natural, orientation: 1, upright: natural, autoRotate: false, turn: item.turn, pan: item.pan, printSize }
    } else {
      const photo = source.photos[index]!
      const natural = photoNaturalSize(photo)
      content = {
        ref: index,
        natural,
        orientation: photo.orientation,
        upright: photo.orientation <= 4 ? natural : flipped(natural),
        autoRotate: printSize.kind !== "percent",
        turn: item.turn,
        pan: item.pan,
        printSize,
      }
    }
    return Array<Content>(item.count).fill(content)
  })

  const { cells: areas, sideways } = cells(options.layout, sheet, margins, landscapeFirst(source, options.items))
  if (areas.length === 0) return []
  // Everything is laid out the way the sheet is read, and only then put onto the sheet the way the Printer feeds it.
  const asRead = (box: Box): Box =>
    sideways ? { left: box.top, top: sheet.width - box.left - box.width, width: box.height, height: box.width } : box
  const onSheet = (box: Box): Box =>
    sideways ? { left: sheet.width - box.top - box.height, top: box.left, width: box.height, height: box.width } : box

  const [across, down] = POSITIONS[options.position]
  const sheets: Sheet[] = []
  for (let first = 0; first < contents.length; first += areas.length) {
    const onThisSheet = contents.slice(first, first + areas.length)
    const result: Sheet = { placements: [], cutOff: false, emptySpace: onThisSheet.length < areas.length, sideways, cutLines: [] }
    onThisSheet.forEach((content, index) => {
      const cell = areas[index]!
      const whole = asRead(cell.box)
      const printable = asRead(cell.printable)
      const { upright, printSize } = content
      // A landscape photo on a portrait sheet, or the reverse. Squares stay.
      const liesAcross = (upright.width - upright.height) * (whole.width - whole.height) < 0
      const viewRotation = ((content.autoRotate && liesAcross ? 90 : 0) + content.turn) % 360
      const turned = viewRotation % 180 === 0 ? upright : flipped(upright)
      const scale =
        printSize.kind === "fit" ? Math.min(printable.width / turned.width, printable.height / turned.height)
        : printSize.kind === "fill" ? Math.max(whole.width / turned.width, whole.height / turned.height)
        : printSize.value / 100
      const width = turned.width * scale
      const height = turned.height * scale
      const overflowX = width > printable.width + TOLERANCE ? width - printable.width : 0
      const overflowY = height > printable.height + TOLERANCE ? height - printable.height : 0
      const panned = content.pan ? readPan(content.pan, viewRotation as Rotation) : {}
      const along = { x: overflowX > 0 ? (panned.x ?? across) : across, y: overflowY > 0 ? (panned.y ?? down) : down }
      const box = onSheet({
        left: printable.left + (printable.width - width) * along.x,
        top: printable.top + (printable.height - height) * along.y,
        width,
        height,
      })
      const rotation = ((viewRotation + (sideways ? 90 : 0)) % 360) as Rotation
      result.placements.push({
        ref: content.ref,
        rotation,
        scale,
        pan: { ...along, overflowX, overflowY, rotation: viewRotation as Rotation },
        ...box,
        matrix: matrixFor(
          compose(TURNS[rotation], ORIENTATIONS[content.orientation]),
          content.natural,
          scale,
          box.left,
          sheet.height - box.top - box.height,
        ),
        clip: cell.box,
      })
      result.cutOff ||= !atFormat && (width > printable.width + TOLERANCE || height > printable.height + TOLERANCE)
      result.emptySpace ||= width < printable.width - TOLERANCE || height < printable.height - TOLERANCE
      if (options.layout.kind === "format" && options.layout.cutLines) result.cutLines.push(cell.box)
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

/** The most sheets of paper one Print Job may take, copies included: a mistake can't empty the paper tray. */
export const maxSheets = 100

/** Whether a Print Job takes more than `maxSheets`. The options screen and the renderer both ask here, so they agree. */
export function overSheetLimit(sheets: readonly Sheet[], copies: number): boolean {
  return sheetCount(sheets, copies) > maxSheets
}

function flipped({ width, height }: Size): Size {
  return { width: height, height: width }
}

type Pan = NonNullable<Item["pan"]>

/** A pan with only the axes that are given. */
function axes(x: number | undefined, y: number | undefined): Pan {
  return { ...(x !== undefined && { x }), ...(y !== undefined && { y }) }
}

const behind = (n: number | undefined) => (n === undefined ? undefined : 1 - n)

/**
 * An item's pan along the content's own axes (0: its left or top edge flush, 1: its right or bottom edge) as it lies
 * along the axes of the sheet as read, when the upright content is turned clockwise by `rotation`: turned a quarter, its
 * left edge is the top one and its bottom edge the left one.
 */
export function readPan({ x: u, y: v }: Pan, rotation: Rotation): Pan {
  if (rotation === 90) return axes(behind(v), u)
  if (rotation === 180) return axes(behind(u), behind(v))
  if (rotation === 270) return axes(v, behind(u))
  return axes(u, v)
}

/** The reverse of `readPan`: a pan made along the sheet's axes, as an item's pan along its own. */
export function contentPan({ x, y }: Pan, rotation: Rotation): Pan {
  if (rotation === 90) return axes(y, behind(x))
  if (rotation === 180) return axes(behind(x), behind(y))
  if (rotation === 270) return axes(behind(y), x)
  return axes(x, y)
}
