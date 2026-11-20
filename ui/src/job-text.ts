// The German words for the Print Options, as the options screen, the confirmation and "Nochmal drucken?" say them.
import type { FormatLayout, Item, Layout, Paper, Position, PrintOptions, PrintSizeMode } from "../../shared/print-options.ts"

export const paperNames: Record<Paper, string> = { A4: "A4", A5: "A5", EnvDL: "Umschlag DL", EnvC5: "Umschlag C5" }

export const qualityNames: Record<PrintOptions["quality"], string> = { normal: "Normal", draft: "Toner sparen" }

export const positionNames: Record<Position, string> = {
  "top-left": "oben links", top: "oben", "top-right": "oben rechts",
  left: "links", center: "Mitte", right: "rechts",
  "bottom-left": "unten links", bottom: "unten", "bottom-right": "unten rechts",
}

/** Einpassen and Füllen, for all pages or photos or for one. */
export const sizeNames: Record<NonNullable<Item["size"]>, string> = { fit: "Einpassen", fill: "Füllen" }

/** How the photos lie at a Photo format. */
export const lageNames: Record<FormatLayout["lage"], string> = { save: "Platz sparen", portrait: "Alle hoch", landscape: "Alle quer" }

/** The short words of the named Photo formats. */
export const formatNames: Record<Exclude<FormatLayout["format"], object>, string> = { "10x15": "10×15", "9x13": "9×13", "13x18": "13×18", pass: "Passbild" }

/** A layout's short name: "Normal", "8×", "10×15", or "Eigenes 60 × 90 mm". */
export function layoutName(layout: Layout) {
  if (layout.kind === "grid") return layout.perSheet === 1 ? "Normal" : `${layout.perSheet}×`
  return typeof layout.format === "string" ? formatNames[layout.format] : `Eigenes ${layout.format.w} × ${layout.format.h} mm`
}

/** How a page or photo is called: people count photos from 1. */
export const itemName = (kind: "pdf" | "photos", ref: number) => (kind === "pdf" ? `Seite ${ref}` : `Foto ${ref + 1}`)

/** "3 Seiten", "1 Seite": the number with the word in the right form. */
export const counted = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** The pages or photos that print, numbered from 1 in the file's order, as people count them. */
export const printedNumbers = (items: readonly Item[]) => items.flatMap((item, index) => (item.count > 0 ? [index + 1] : []))

/** Page numbers in rising order as "1-3, 5". */
export function ranges(numbers: readonly number[]) {
  const groups: string[] = []
  for (let from = 0; from < numbers.length;) {
    let to = from
    while (numbers[to + 1] === numbers[to]! + 1) to++
    groups.push(to > from ? `${numbers[from]}-${numbers[to]}` : `${numbers[from]}`)
    from = to + 1
  }
  return groups.join(", ")
}

/**
 * The Print size with the percentage it gives: "Einpassen (97 %)", "Füllen (104 %)" or "71 %".
 * `percent` comes from the layout; while it isn't known, Einpassen and Füllen stand alone.
 */
export function printSizeText(printSize: PrintSizeMode, percent: number | undefined) {
  if (printSize.kind === "percent") return `${printSize.value} %`
  const name = sizeNames[printSize.kind]
  return percent === undefined ? name : `${name} (${percent} %)`
}
