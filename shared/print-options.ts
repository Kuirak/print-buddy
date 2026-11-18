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
