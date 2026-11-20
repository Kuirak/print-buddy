// The German words for the Print Options, as the summary line and the confirmation say them.
import type { Item, Paper, Position, PrintOptions, PrintSizeMode } from "../../shared/print-options.ts"

export const paperNames: Record<Paper, string> = { A4: "A4", A5: "A5", EnvDL: "Umschlag DL", EnvC5: "Umschlag C5" }

export const qualityNames: Record<PrintOptions["quality"], string> = { normal: "Normal", draft: "Toner sparen" }

export const positionNames: Record<Position, string> = {
  "top-left": "oben links", top: "oben", "top-right": "oben rechts",
  left: "links", center: "Mitte", right: "rechts",
  "bottom-left": "unten links", bottom: "unten", "bottom-right": "unten rechts",
}

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
  const name = printSize.kind === "fit" ? "Einpassen" : "Füllen"
  return percent === undefined ? name : `${name} (${percent} %)`
}
