import type { PrintOptions } from "../../../shared/print-options.ts"
import { paperNames, positionNames, printedNumbers, printSizeText, qualityNames, ranges } from "../job-text.ts"

/** Everything that is chosen in one line, and "Ändern", which opens the detailed controls. */
export function SummaryLine(props: {
  kind: "pdf" | "photos"
  /** How many pages the PDF has, or how many photos were shared. */
  total: number
  options: PrintOptions
  /** The percentage the content is printed at, as the Print size row shows it. */
  percent: number | undefined
  onChange: () => void
}) {
  /** Which pages or photos print: "alle 6 Seiten", "Seiten 1-3, 5", "2 von 3 Fotos". */
  const chosen = () => {
    const printed = printedNumbers(props.options.items)
    const pdf = props.kind === "pdf"
    if (printed.length === 0) return pdf ? "keine Seiten" : "keine Fotos"
    if (props.total === 1) return pdf ? "1 Seite" : "1 Foto"
    if (printed.length === props.total) return `alle ${props.total} ${pdf ? "Seiten" : "Fotos"}`
    return pdf ? `${printed.length === 1 ? "Seite" : "Seiten"} ${ranges(printed)}` : `${printed.length} von ${props.total} Fotos`
  }
  const parts = () => {
    const { layout } = props.options
    const perSheet = layout.kind === "grid" ? layout.perSheet : 1
    return [
      `${props.options.copies}×`,
      props.options.color === "color" ? "Farbe" : "S/W",
      paperNames[props.options.paper],
      qualityNames[props.options.quality],
      printSizeText(props.options.printSize, props.percent),
      positionNames[props.options.position],
      // photos say it only when they share a sheet
      ...(props.kind === "pdf" ? [perSheet === 1 ? "1 Seite pro Blatt" : `${perSheet} Seiten pro Blatt`] : perSheet > 1 ? [`${perSheet} Fotos pro Blatt`] : []),
      chosen(),
    ]
  }
  return (
    <div class="flex items-center justify-between gap-3">
      <span role="status" aria-label="Gewählte Einstellungen" class="text-sm text-muted">{parts().join(" · ")}</span>
      <button type="button" class="min-h-10 shrink-0 cursor-pointer rounded-lg border border-gray-300 px-3 py-1.5 font-semibold" onClick={props.onChange}>Ändern</button>
    </div>
  )
}
