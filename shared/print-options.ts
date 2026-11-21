// Print Options: the choices a family member makes before a Print Job starts (see GLOSSARY.md).
// The one definition for the browser and the server. Keep this file free of DOM and Node imports.

/** `percent` 100 is the natural size. */
export type PrintSizeMode = { kind: "fit" } | { kind: "fill" } | { kind: "percent"; value: number }

export type Position =
  | "top-left" | "top" | "top-right"
  | "left" | "center" | "right"
  | "bottom-left" | "bottom" | "bottom-right"

/** How many equal Cells a grid divides the sheet into. */
export type PerSheet = 1 | 2 | 4 | 6 | 8

/** How a sheet is divided: into equal Cells, or into slots of a Photo format (see GLOSSARY.md). */
export type Layout =
  | { kind: "grid"; perSheet: PerSheet }
  | {
      /** Photos only. */
      kind: "format"
      /** A named Photo format, or an own size in mm. */
      format: "10x15" | "9x13" | "13x18" | "pass" | { w: number; h: number }
      lage: "save" | "portrait" | "landscape"
      /** 2 mm between slots. */
      gap: boolean
      /** A hairline around each slot. */
      cutLines: boolean
    }

export type FormatLayout = Extract<Layout, { kind: "format" }>

/** What is chosen for one page of the PDF or one photo. */
export type Item = {
  /** Repeats, 0 to `maxCount`: how often it appears on the sheets of one copy. 0 leaves it out. */
  count: number
  /**
   * Pans this page or photo where it overlaps the border of the printable area: how far along the overlap it lies,
   * as the sheet is read, 0 (left or top edge flush) to 1 (right or bottom edge flush). Replaces Position on each
   * axis where the content overlaps; an axis where it doesn't has no panning.
   */
  pan?: { x: number; y: number }
  /** Clockwise, added to the turn the layout module gives it by itself. */
  turn: 0 | 90 | 180 | 270
  /** Replaces `printSize` for this page or photo. */
  size?: "fill" | "fit"
}

export type Rotation = Item["turn"]

export type PrintOptions = {
  copies: number
  color: "color" | "mono"
  paper: "A4" | "A5" | "EnvDL" | "EnvC5"
  /** "Toner sparen" is `draft`. */
  quality: "normal" | "draft"
  printSize: PrintSizeMode
  position: Position
  layout: Layout
  /** One per page of the PDF or per photo, in the file's order. */
  items: Item[]
}

export type Paper = PrintOptions["paper"]

export const papers: readonly Paper[] = ["A4", "A5", "EnvDL", "EnvC5"]

export const maxCopies = 100

/** The most an item can be repeated on the sheets of one copy. */
export const maxCount = 50

/** The named Photo formats, upright, in mm. */
export const photoFormats = {
  "10x15": { w: 100, h: 150 },
  "9x13": { w: 90, h: 130 },
  "13x18": { w: 130, h: 180 },
  pass: { w: 35, h: 45 },
} as const satisfies Record<string, { w: number; h: number }>

/** The smallest own size, in mm on each side. Whether an own size fits the paper is the layout module's to say. */
export const minOwnSize = 20

const positions: readonly Position[] = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"]
const rotations: readonly unknown[] = [0, 90, 180, 270]
const perSheets: readonly unknown[] = [1, 2, 4, 6, 8]
const lagen: readonly unknown[] = ["save", "portrait", "landscape"]

function isPrintSize(value: unknown): value is PrintSizeMode {
  if (typeof value !== "object" || value === null) return false
  const size = value as { kind?: unknown; value?: unknown }
  if (size.kind === "fit" || size.kind === "fill") return true
  return size.kind === "percent" && typeof size.value === "number" && Number.isFinite(size.value) && size.value > 0
}

function parseLayout(value: unknown): Layout | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const l = value as Record<string, unknown>
  if (l.kind === "grid") return perSheets.includes(l.perSheet) ? { kind: "grid", perSheet: l.perSheet as PerSheet } : undefined
  if (l.kind !== "format" || !lagen.includes(l.lage) || typeof l.gap !== "boolean" || typeof l.cutLines !== "boolean") return undefined
  let format: FormatLayout["format"]
  if (typeof l.format === "string" && Object.hasOwn(photoFormats, l.format)) format = l.format as keyof typeof photoFormats
  else if (typeof l.format === "object" && l.format !== null) {
    const { w, h } = l.format as Record<string, unknown>
    const side = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= minOwnSize
    if (!side(w) || !side(h)) return undefined
    format = { w, h }
  } else return undefined
  return { kind: "format", format, lage: l.lage as "save" | "portrait" | "landscape", gap: l.gap, cutLines: l.cutLines }
}

function parsePan(value: unknown): Item["pan"] | null | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "object" || value === null) return null
  const { x, y } = value as Record<string, unknown>
  const share = (n: unknown): n is number => typeof n === "number" && n >= 0 && n <= 1
  return share(x) && share(y) ? { x, y } : null
}

function parseItem(value: unknown): Item | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const { count, turn, size, pan } = value as Record<string, unknown>
  if (!Number.isInteger(count) || (count as number) < 0 || (count as number) > maxCount) return undefined
  if (!rotations.includes(turn)) return undefined
  if (size !== undefined && size !== "fill" && size !== "fit") return undefined
  const parsedPan = parsePan(pan)
  if (parsedPan === null) return undefined
  return { count: count as number, turn: turn as Rotation, ...(size && { size }), ...(parsedPan && { pan: parsedPan }) }
}

/**
 * Checks Print Options that came from outside (the request body of a submit, or browser storage). Returns them with
 * unknown keys dropped, or `undefined` if anything is missing or out of range: a count outside 0 to `maxCount`, every
 * count 0, an own size under `minOwnSize`.
 * Whether `items` fits the files of the draft, a format suits them, an own size fits the paper and the Print Job
 * keeps to the sheet limit is checked by the renderer.
 */
export function parsePrintOptions(value: unknown): PrintOptions | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const o = value as Record<string, unknown>
  if (!Number.isInteger(o.copies) || (o.copies as number) < 1 || (o.copies as number) > maxCopies) return undefined
  if (o.color !== "color" && o.color !== "mono") return undefined
  if (!papers.includes(o.paper as Paper)) return undefined
  if (o.quality !== "normal" && o.quality !== "draft") return undefined
  if (!isPrintSize(o.printSize)) return undefined
  if (!positions.includes(o.position as Position)) return undefined
  const layout = parseLayout(o.layout)
  if (!layout || !Array.isArray(o.items)) return undefined
  const items = o.items.map(parseItem)
  if (!items.every(item => item !== undefined) || !items.some(item => item.count > 0)) return undefined
  return {
    copies: o.copies as number,
    color: o.color,
    paper: o.paper as Paper,
    quality: o.quality,
    printSize: o.printSize.kind === "percent" ? { kind: "percent", value: o.printSize.value } : { kind: o.printSize.kind },
    position: o.position as Position,
    layout,
    items,
  }
}
