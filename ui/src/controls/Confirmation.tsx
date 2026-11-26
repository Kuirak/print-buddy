import { For, Show } from "solid-js"
import { maxSheets } from "../../../shared/layout.ts"
import type { PrintOptions } from "../../../shared/print-options.ts"
import { counted, lageNames, layoutName, paperNames, positionNames, printSizeText, qualityNames } from "../job-text.ts"
import type { ConfirmationNumbers } from "../print-options-editor.ts"
import { Dialog } from "./Dialog.tsx"
import { DisplayChip } from "./DisplayChip.tsx"
import { PdfPage } from "./PdfPage.tsx"
import type { PreviewSource } from "./Preview.tsx"

/** More pages than this, and the confirmation says them in one line instead of showing each. */
const onePerLineAbove = 30

/**
 * "Jetzt drucken?": what will come out of the Printer, before any paper is used, as a panel from the bottom. From top
 * to bottom: the sheets of paper for all copies, big, beside the sketch of the layout; the pages or photos with how
 * often each prints; every setting in use as a chip; one line for the one message that matters; Abbrechen and Drucken.
 * Every part keeps its height, so the panel is as tall for any Print Job. Nothing in here is laid out: the sheets,
 * the percentage and the cut-off come from the layout module.
 */
export function Confirmation(props: {
  kind: "pdf" | "photos"
  source: PreviewSource
  /** Every page number of the PDF (from 1) or every photo index (from 0), in the order of `options.items`. */
  refs: readonly number[]
  options: PrintOptions
  /** The sheets, the sketch of the layout, the percentage, mixed sizes, cut-off and the limit: from the editor's `derive`. */
  numbers: ConfirmationNumbers
  onConfirm: () => void
  onBack: () => void
}) {
  const pdf = () => props.kind === "pdf"
  const counts = () => props.options.items.map(item => item.count)
  const settings = () => {
    const { options } = props
    const { layout } = options
    return [
      options.color === "color" ? "Farbe" : "S/W",
      paperNames[options.paper],
      qualityNames[options.quality],
      props.numbers.mixedSizes ? (pdf() ? "Größe je Seite" : "Größe je Foto") : printSizeText(options.printSize, props.numbers.percent),
      ...(layout.kind === "format"
        ? [lageNames[layout.lage], ...(layout.gap ? ["Abstand"] : []), ...(layout.cutLines ? ["Schnittlinien"] : [])]
        : [positionNames[options.position]]),
      ...(options.copies > 1 ? [counted(options.copies, "Kopie", "Kopien")] : []),
    ]
  }
  /** A long PDF in one line: "37 von 40 Seiten, je 1× · 3 aus". */
  const pagesLine = () => {
    const printed = counts().filter(count => count > 0)
    const out = counts().length - printed.length
    const same = printed.every(count => count === printed[0])
    return `${printed.length} von ${counts().length} Seiten${same && printed.length > 0 ? `, je ${printed[0]}×` : ""}${out > 0 ? ` · ${out} aus` : ""}`
  }
  return (
    <Dialog label="Jetzt drucken?" at="bottom" onClose={props.onBack}>
      <div class="flex items-center gap-4">
        <div class="w-28 shrink-0 text-center">
          <output aria-label="Blätter insgesamt" class={`block text-5xl font-extrabold ${props.numbers.overLimit ? "text-[#b3261e]" : ""}`}>{props.numbers.sheets}</output>
          <div class="font-semibold">{props.numbers.sheets === 1 ? "Blatt" : "Blätter"}</div>
          <div class="text-sm text-muted">{props.options.copies > 1 ? `${props.numbers.sheetsPerCopy} × ${props.options.copies} Kopien` : "1 Kopie"}</div>
        </div>
        <div class="flex min-w-0 flex-1 items-center gap-3 border-l border-gray-200 pl-4">
          <svg aria-hidden="true" class="h-24 shrink-0" viewBox={`0 0 ${props.numbers.paper.width} ${props.numbers.paper.height}`}>
            <rect width={props.numbers.paper.width} height={props.numbers.paper.height} fill="white" stroke="#999" stroke-width={props.numbers.paper.width / 80} />
            <For each={props.numbers.cells}>
              {cell => {
                const inset = props.numbers.paper.width / 80
                return <rect x={cell.left + inset} y={cell.top + inset} width={cell.width - 2 * inset} height={cell.height - 2 * inset} fill="#cfe0f7" />
              }}
            </For>
          </svg>
          <span class="font-semibold">{layoutName(props.options.layout)}</span>
        </div>
      </div>
      {/* one row of 56 px: the pages or photos with how often each prints, or a long PDF in one line */}
      <Show
        when={props.refs.length <= onePerLineAbove}
        fallback={<p class="flex h-14 items-center rounded-lg bg-gray-50 px-3 text-sm">{pagesLine()}</p>}
      >
        <ul aria-label={pdf() ? "Seiten" : "Fotos"} class="flex h-14 gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <For each={props.refs}>
            {(ref, index) => {
              const count = () => counts()[index()] ?? 0
              return (
                <li class={`relative size-14 shrink-0 overflow-hidden rounded border ${count() > 0 ? "border-gray-300" : "border-gray-200 opacity-40"}`}>
                  <div class="size-full" style={{ filter: props.options.color === "mono" ? "grayscale(1)" : "none" }}>
                    <Show
                      when={props.source.kind === "photos" && props.source}
                      fallback={<PdfPage pdf={props.source.kind === "pdf" ? props.source.pdf : undefined} page={ref} longSide={112} fit="contain" />}
                    >
                      {photos => <img class="block size-full object-cover" src={photos().urls[ref]} alt="" />}
                    </Show>
                  </div>
                  <span class="absolute top-0.5 right-0.5 rounded-full bg-ink px-1.5 text-xs font-extrabold text-white ring-1 ring-white">{count() > 0 ? `${count()}×` : "aus"}</span>
                </li>
              )
            }}
          </For>
        </ul>
      </Show>
      {/* two rows of chips always have room; more wrap to a third */}
      <ul aria-label="Einstellungen" class="flex min-h-[62px] flex-wrap content-start gap-1.5">
        <For each={settings()}>{setting => <li><DisplayChip text={setting} /></li>}</For>
      </ul>
      {/* one line of fixed height for the one message that matters most */}
      <p role="status" aria-label="Hinweis" class={`flex min-h-10 items-center ${props.numbers.overLimit ? "rounded-lg bg-[#fdecea] px-2 text-sm text-[#b3261e]" : props.numbers.cutOff ? "note scribble -rotate-1 bg-note-yellow" : ""}`}>
        {props.numbers.overLimit ? `⛔ Höchstens ${maxSheets} Blätter pro Druck.` : props.numbers.cutOff ? "⚠ Teile des Inhalts werden abgeschnitten." : ""}
      </p>
      <div class="flex gap-2">
        <button type="button" class="btn-secondary" onClick={props.onBack}>Abbrechen</button>
        <button type="button" class="btn-primary" disabled={props.numbers.overLimit} onClick={props.onConfirm}>Drucken</button>
      </div>
    </Dialog>
  )
}
