import { createMemo, createSignal, createStore, onSettled, Show, snapshot, untrack } from "solid-js"
import type { JSX } from "@solidjs/web"
import type { FileFacts, PaperMargins } from "../../../shared/api.ts"
import { layout, SHEET_SIZES, type LayoutInput } from "../../../shared/layout.ts"
import { maxCopies, type PrintOptions, type Rotation } from "../../../shared/print-options.ts"
import { readPrinter } from "../api.ts"
import { ChoiceGroup } from "../controls/ChoiceGroup.tsx"
import { PositionGrid } from "../controls/PositionGrid.tsx"
import { PresetActions } from "../controls/PresetActions.tsx"
import { PresetChips } from "../controls/PresetChips.tsx"
import { Preview } from "../controls/Preview.tsx"
import { PrintSize } from "../controls/PrintSize.tsx"
import { SheetSteps } from "../controls/SheetSteps.tsx"
import { Stepper } from "../controls/Stepper.tsx"
import { Thumbnails } from "../controls/Thumbnails.tsx"
import { ViewZoom } from "../controls/ViewZoom.tsx"
import { openPdf, type PdfPreview } from "../pdf-preview.ts"
import { createPresets, type FileKind, type Preset } from "../presets.ts"

const colors = [
  { value: "color", label: "Farbe" },
  { value: "mono", label: "S/W" },
] as const

const papers = [
  { value: "A4", label: "A4" },
  { value: "A5", label: "A5" },
  { value: "EnvDL", label: "Umschlag DL" },
  { value: "EnvC5", label: "Umschlag C5" },
] as const

const qualities = [
  { value: "normal", label: "Normal" },
  { value: "draft", label: "Toner sparen" },
] as const

const perSheet = [
  { value: 1, label: "1" },
  { value: 2, label: "2" },
] as const

function Row(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex items-center justify-between gap-4 border-b border-gray-200 py-2">
      <span class="shrink-0">{props.label}</span>
      {props.children}
    </div>
  )
}

export function OptionsScreen(props: {
  fileName: string
  kind: FileKind
  /** The phone's copies of the files of the Print Job, in order. */
  files: File[]
  /** What the server found out about each of them. */
  facts: FileFacts[]
  onPrint: (options: PrintOptions) => void
}) {
  const presets = createPresets(untrack(() => props.kind))
  // the files never change while their options screen is open
  const files = untrack(() => props.files)
  const facts = untrack(() => props.facts)
  const source: LayoutInput["source"] =
    facts[0]?.kind === "pdf" ? facts[0] : { kind: "photos", photos: facts.filter(fact => fact.kind === "photo") }
  /** Every page of the PDF, counted from 1, or every photo, counted from 0: what the thumbnails show and the selection picks from. */
  const refs = source.kind === "pdf" ? source.pages.map((_, index) => index + 1) : source.photos.map((_, index) => index)
  // a new file starts from the starred Preset, never from the settings of the job before, with every page or photo selected
  const [options, setOptions] = createStore<PrintOptions>({
    ...structuredClone(presets.starred().values),
    rotation: 0,
    selection: [...refs],
  })

  const [margins, setMargins] = createSignal<PaperMargins>()
  // what the preview draws: the PDF's pages through pdf.js, or the photos straight from the phone's copies
  const [pdf, setPdf] = createSignal<PdfPreview>()
  const photoUrls = source.kind === "photos" ? files.map(file => URL.createObjectURL(file)) : []
  const [zoom, setZoom] = createSignal(1)
  onSettled(() => {
    let left = false
    let opened: PdfPreview | undefined
    void readPrinter().then(printer => setMargins(printer.margins))
    if (source.kind === "pdf") {
      void (async () => {
        opened = await openPdf(await files[0]!.arrayBuffer())
        if (left) void opened.destroy()
        else setPdf(opened)
      })()
    }
    return () => {
      left = true
      void opened?.destroy()
      for (const url of photoUrls) URL.revokeObjectURL(url)
    }
  })
  /** Where everything sits, sheet by sheet. The preview, the percentage and the cut-off warning all read this. */
  const sheets = createMemo(() => {
    const known = margins()
    return known && layout({ source, options, sheet: SHEET_SIZES[options.paper], margins: known[options.paper] })
  })
  /** Which sheet the person stepped to, counted from 0. It may point past the end after pages were left out. */
  const [step, setStep] = createSignal(0)
  /** The sheet in the preview, counted from 0: the one stepped to, or the last one there is. */
  const current = () => Math.max(0, Math.min(step(), (sheets()?.length ?? 1) - 1))
  const shown = () => sheets()?.[current()]
  /** What the preview shows and which sheet of how many it is, for one copy. */
  const sheetText = () => {
    const onSheet = shown()?.placements.map(placement => placement.ref)
    if (!onSheet?.length) return source.kind === "pdf" ? "Keine Seiten ausgewählt" : "Keine Fotos ausgewählt"
    const place = `${current() + 1}/${sheets()!.length}`
    if (source.kind === "photos") return `Foto ${place}`
    return `${onSheet.length === 1 ? "Seite" : "Seiten"} ${onSheet.join(" und ")} · ${place}`
  }
  const percent = () => {
    if (options.printSize.kind === "percent") return options.printSize.value
    const first = shown()?.placements[0]
    return first && Math.round(first.scale * 100)
  }

  /** Sets what the Preset stores. Page selection and rotation stay as they are. */
  function apply(preset: Preset) {
    presets.pick(preset)
    setOptions(o => { Object.assign(o, structuredClone(preset.values)) })
  }

  /** A quarter turn clockwise: of the whole PDF, or of the photo in the preview. */
  function turn() {
    const photo = shown()?.placements[0]?.ref
    const quarterOn = (rotation: Rotation = 0) => ((rotation + 90) % 360) as Rotation
    setOptions(o => {
      if (source.kind === "pdf") o.rotation = quarterOn(o.rotation)
      else if (photo !== undefined) o.photoRotations = { ...o.photoRotations, [photo]: quarterOn(o.photoRotations?.[photo]) }
    })
  }

  /** Leaves a page or photo out, or brings it back to its place in the file's order. The preview goes to one brought back. */
  function toggle(ref: number) {
    const selected = options.selection.includes(ref)
    const selection = selected ? options.selection.filter(other => other !== ref) : [...options.selection, ref].sort((a, b) => a - b)
    setOptions(o => { o.selection = selection })
    if (!selected) setStep(Math.floor(selection.indexOf(ref) / (source.kind === "pdf" ? options.pagesPerSheet : 1)))
  }

  function select(selection: number[]) {
    setOptions(o => { o.selection = selection })
    setStep(0)
  }

  return (
    <main class="flex min-h-dvh flex-col gap-4 p-4">
      <h1 class="truncate font-bold">{props.fileName}</h1>
      <PresetChips presets={presets} options={options} onPick={apply} />
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between gap-2">
          <button
            type="button"
            class="min-h-11 cursor-pointer rounded-lg border border-gray-300 px-3 py-2 font-semibold disabled:cursor-default disabled:opacity-40"
            disabled={!shown()}
            onClick={turn}
          >
            <span aria-hidden="true">⟳ </span>Drehen
          </button>
          <ViewZoom value={zoom()} onChange={setZoom} />
        </div>
        <Preview
          paper={SHEET_SIZES[options.paper]}
          margins={margins()?.[options.paper]}
          sheet={shown()}
          source={source.kind === "pdf" ? { kind: "pdf", pdf: pdf() } : { kind: "photos", urls: photoUrls }}
          grey={options.color === "mono"}
          zoom={zoom()}
        />
        <Show when={sheets()}>
          {laidOut => <SheetSteps index={current()} count={laidOut().length} text={sheetText()} onChange={setStep} />}
        </Show>
      </div>
      <div class="flex flex-col gap-1">
        <PrintSize value={options.printSize} percent={percent()} onChange={printSize => setOptions(o => { o.printSize = printSize })} />
        {/* a Print Job is cut off when any of its sheets is */}
        <Show when={sheets()?.some(sheet => sheet.cutOff)}>
          <p role="alert" class="rounded-lg bg-[#fff1d6] px-3 py-2 text-sm text-[#7a4b00]">Achtung: Teile des Inhalts werden abgeschnitten.</p>
        </Show>
      </div>
      <Thumbnails
        source={source.kind === "pdf" ? { kind: "pdf", pdf: pdf() } : { kind: "photos", urls: photoUrls }}
        refs={refs}
        selection={options.selection}
        grey={options.color === "mono"}
        onToggle={toggle}
        onAll={() => select([...refs])}
        onNone={() => select([])}
      />
      <section>
        <Row label="Position">
          <PositionGrid value={options.position} onChange={position => setOptions(o => { o.position = position })} />
        </Row>
        <Show when={source.kind === "pdf"}>
          <Row label="Seiten pro Blatt">
            <ChoiceGroup label="Seiten pro Blatt" choices={perSheet} value={options.pagesPerSheet} onChange={pagesPerSheet => setOptions(o => { o.pagesPerSheet = pagesPerSheet })} />
          </Row>
        </Show>
        <Row label="Kopien">
          <Stepper
            label="Kopien"
            decreaseLabel="Weniger Kopien"
            increaseLabel="Mehr Kopien"
            value={options.copies}
            min={1}
            max={maxCopies}
            onChange={copies => setOptions(o => { o.copies = copies })}
          />
        </Row>
        <Row label="Farbe">
          <ChoiceGroup label="Farbe" choices={colors} value={options.color} onChange={color => setOptions(o => { o.color = color })} />
        </Row>
        <Row label="Papier">
          <ChoiceGroup label="Papier" choices={papers} value={options.paper} onChange={paper => setOptions(o => { o.paper = paper })} />
        </Row>
        <Row label="Qualität">
          <ChoiceGroup label="Qualität" choices={qualities} value={options.quality} onChange={quality => setOptions(o => { o.quality = quality })} />
        </Row>
      </section>
      <PresetActions presets={presets} options={options} onPick={apply} />
      <div class="sticky bottom-0 mt-auto bg-white py-3">
        <button type="button" class="btn-primary" disabled={options.selection.length === 0} onClick={() => props.onPrint(snapshot(options))}>
          {options.selection.length > 0 ? "Drucken" : source.kind === "pdf" ? "Keine Seiten gewählt" : "Keine Fotos gewählt"}
        </button>
      </div>
    </main>
  )
}
