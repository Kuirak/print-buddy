import { Show } from "solid-js"
import type { PrintOptions } from "../../../shared/print-options.ts"
import { counted, paperNames, printedNumbers, printSizeText, ranges } from "../job-text.ts"
import { Dialog } from "./Dialog.tsx"

/**
 * "Jetzt drucken?": what will come out of the Printer, before any paper is used.
 * Nothing in here is computed: the sheet count, the percentage and the warning come from the layout module.
 */
export function Confirmation(props: {
  fileName: string
  kind: "pdf" | "photos"
  /** How many pages the PDF has, or how many photos were shared. */
  total: number
  options: PrintOptions
  /** Sheets of paper for all copies. */
  sheets: number
  /** The percentage the content is printed at, as the Print size row shows it. */
  percent: number | undefined
  cutOff: boolean
  onConfirm: () => void
  onBack: () => void
}) {
  /** What is printed: "3 Seiten (1-2, 5)", "6 Seiten (2 pro Blatt)", "3 Fotos (4 pro Blatt)". */
  const content = () => {
    const printed = printedNumbers(props.options.items)
    const count = printed.length
    const { layout } = props.options
    const shared = layout.kind === "grid" && layout.perSheet > 1 ? [`${layout.perSheet} pro Blatt`] : []
    if (props.kind === "photos") return counted(count, "Foto", "Fotos") + (shared.length ? ` (${shared[0]})` : "")
    const notes = [...(count < props.total ? [ranges(printed)] : []), ...shared]
    return counted(count, "Seite", "Seiten") + (notes.length ? ` (${notes.join("; ")})` : "")
  }
  return (
    <Dialog label="Jetzt drucken?" at="bottom" onClose={props.onBack}>
      <div>
        <h2 class="text-lg font-bold">Jetzt drucken?</h2>
        <p class="truncate text-muted">{props.fileName}</p>
      </div>
      <ul class="flex list-disc flex-col gap-1 pl-5">
        <li>
          {content()} × {counted(props.options.copies, "Kopie", "Kopien")} = <strong>{counted(props.sheets, "Blatt", "Blätter")}</strong>
        </li>
        <li>
          {props.options.color === "color" ? "Farbe" : "Schwarz-Weiß"} · {paperNames[props.options.paper]} · {printSizeText(props.options.printSize, props.percent)}
          {props.options.quality === "draft" ? " · Toner sparen" : ""}
        </li>
      </ul>
      <Show when={props.cutOff}>
        <p class="text-[#a05a00]">⚠ Teile des Inhalts werden abgeschnitten.</p>
      </Show>
      <div class="flex gap-2">
        <button type="button" class="btn-secondary" onClick={props.onBack}>Abbrechen</button>
        <button type="button" class="btn-primary" onClick={props.onConfirm}>Drucken</button>
      </div>
    </Dialog>
  )
}
