// Print Options: the choices a family member makes before a Print Job starts (see GLOSSARY.md).
// The one definition for the browser and the server. Keep this file free of DOM and Node imports.

/** `percent` 100 is the natural size. */
export type PrintSizeMode = { kind: "fit" } | { kind: "fill" } | { kind: "percent"; value: number }

export type Position =
  | "top-left" | "top" | "top-right"
  | "left" | "center" | "right"
  | "bottom-left" | "bottom" | "bottom-right"

export type Rotation = 0 | 90 | 180 | 270

export type PrintOptions = {
  copies: number
  color: "color" | "mono"
  paper: "A4" | "A5" | "EnvDL" | "EnvC5"
  /** "Toner sparen" is `draft`. */
  quality: "normal" | "draft"
  printSize: PrintSizeMode
  position: Position
  /** 2 only for PDFs. */
  pagesPerSheet: 1 | 2
  /** The whole PDF; photos turn one by one through `photoRotations`. */
  rotation: Rotation
  /** Selected PDF page numbers, or included photo indexes, in order. */
  selection: number[]
  photoRotations?: Record<number, Rotation>
}

export type Paper = PrintOptions["paper"]

export const papers: readonly Paper[] = ["A4", "A5", "EnvDL", "EnvC5"]

export const maxCopies = 100

const positions: readonly Position[] = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"]
const rotations: readonly unknown[] = [0, 90, 180, 270]

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0

function isPrintSize(value: unknown): value is PrintSizeMode {
  if (typeof value !== "object" || value === null) return false
  const size = value as { kind?: unknown; value?: unknown }
  if (size.kind === "fit" || size.kind === "fill") return true
  return size.kind === "percent" && typeof size.value === "number" && Number.isFinite(size.value) && size.value > 0
}

/**
 * Checks Print Options that came from outside (the request body of a submit). Returns them with
 * unknown keys dropped, or `undefined` if anything is missing or out of range.
 * Whether `selection` fits the files of the draft is for the renderer to say.
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
  if (o.pagesPerSheet !== 1 && o.pagesPerSheet !== 2) return undefined
  if (!rotations.includes(o.rotation)) return undefined
  if (!Array.isArray(o.selection) || !o.selection.every(isCount)) return undefined
  const options: PrintOptions = {
    copies: o.copies as number,
    color: o.color,
    paper: o.paper as Paper,
    quality: o.quality,
    printSize: o.printSize.kind === "percent" ? { kind: "percent", value: o.printSize.value } : { kind: o.printSize.kind },
    position: o.position as Position,
    pagesPerSheet: o.pagesPerSheet,
    rotation: o.rotation as Rotation,
    selection: o.selection,
  }
  if (o.photoRotations !== undefined) {
    if (typeof o.photoRotations !== "object" || o.photoRotations === null || Array.isArray(o.photoRotations)) return undefined
    const entries = Object.entries(o.photoRotations)
    if (!entries.every(([index, rotation]) => /^\d+$/.test(index) && rotations.includes(rotation))) return undefined
    options.photoRotations = Object.fromEntries(entries.map(([index, rotation]) => [Number(index), rotation as Rotation]))
  }
  return options
}
