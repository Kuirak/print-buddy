import { createEffect, createMemo, createSignal, createStore, onSettled, Show, snapshot, untrack } from "solid-js"
import type { FileFacts, FileKind, PaperMargins } from "../../../shared/api.ts"
import { layout, sheetCount, SHEET_SIZES, type LayoutInput } from "../../../shared/layout.ts"
import type { PrintOptions, Rotation } from "../../../shared/print-options.ts"
import { isLoginExpired, readPrinter } from "../api.ts"
import { Confirmation } from "../controls/Confirmation.tsx"
import { OptionsDrawer } from "../controls/OptionsDrawer.tsx"
import { PositionGrid } from "../controls/PositionGrid.tsx"
import { PresetChips } from "../controls/PresetChips.tsx"
import { Preview } from "../controls/Preview.tsx"
import { PrintSize } from "../controls/PrintSize.tsx"
import { SheetSteps } from "../controls/SheetSteps.tsx"
import { SummaryLine } from "../controls/SummaryLine.tsx"
import { Thumbnails } from "../controls/Thumbnails.tsx"
import { ViewZoom } from "../controls/ViewZoom.tsx"
import { openPdf, type PdfPreview } from "../pdf-preview.ts"
import { createPresets, type Preset } from "../presets.ts"

const readPrinterAgainAfterMs = 2_000

export function OptionsScreen(props: {
  fileName: string
  kind: FileKind
  /** The phone's copies of the files of the Print Job, in order. */
  files: File[]
  /**
   * The facts of each of them: what the browser read, until the server's replace them once the upload is
   * done. Drucken waits for those, so what is sent is laid out from the server's facts.
   */
  facts: FileFacts[]
  /** While the upload runs: the part of all files' bytes the server has, 0 to 1. Drucken waits for it. */
  uploading?: number
  /** The Print Options the person had chosen for these files before the login ran out. */
  initial?: PrintOptions
  /** The Print Options as they are now, whenever they change, so that they survive a login that runs out meanwhile. */
  onChange: (options: PrintOptions) => void
  onPrint: (options: PrintOptions) => void
  /** "Zurück": the person gives the job up. */
  onBack: () => void
}) {
  const presets = createPresets(untrack(() => props.kind))
  // the files never change while their options screen is open
  const files = untrack(() => props.files)
  /** A PDF or photos, as the layout module names them. The facts can't change it: the server refuses a file of the other type. */
  const kind = untrack(() => props.kind) === "pdf" ? "pdf" : "photos"
  const source = createMemo((): LayoutInput["source"] => {
    const facts = props.facts
    return facts[0]?.kind === "pdf" ? facts[0] : { kind: "photos", photos: facts.filter(fact => fact.kind === "photo") }
  })
  /** Every page of the PDF, counted from 1, or every photo, counted from 0: what the thumbnails show and the selection picks from. */
  const refs = createMemo(() => {
    const known = source()
    return known.kind === "pdf" ? known.pages.map((_, index) => index + 1) : known.photos.map((_, index) => index)
  })
  // a new file starts from the starred Preset, never from the Print Options of the job before, with every page or photo selected
  const [options, setOptions] = createStore<PrintOptions>(structuredClone(untrack(() => props.initial)) ?? {
    ...structuredClone(presets.starred().values),
    rotation: 0,
    selection: [...untrack(refs)],
  })
  createEffect(() => JSON.stringify(options), () => props.onChange(snapshot(options)))

  const [margins, setMargins] = createSignal<PaperMargins>()
  // what the preview draws: the PDF's pages through pdf.js, or the photos straight from the phone's copies
  const [pdf, setPdf] = createSignal<PdfPreview>()
  const photoUrls = kind === "photos" ? files.map(file => URL.createObjectURL(file)) : []
  const [zoom, setZoom] = createSignal(1)
  onSettled(() => {
    let left = false
    let opened: PdfPreview | undefined
    let nextRead: ReturnType<typeof setTimeout> | undefined
    // nothing is laid out without the margins, and Drucken waits for them: a read that fails is tried again.
    // Not once the login has run out: "Anmeldung abgelaufen" shows then.
    async function readMargins() {
      try {
        setMargins((await readPrinter()).margins)
      } catch (failure) {
        if (!left && !isLoginExpired(failure)) nextRead = setTimeout(() => void readMargins(), readPrinterAgainAfterMs)
      }
    }
    void readMargins()
    if (kind === "pdf") {
      void (async () => {
        opened = await openPdf(await files[0]!.arrayBuffer())
        if (left) void opened.destroy()
        else setPdf(opened)
      })()
    }
    return () => {
      left = true
      clearTimeout(nextRead)
      void opened?.destroy()
      for (const url of photoUrls) URL.revokeObjectURL(url)
    }
  })
  /** Where everything sits, sheet by sheet. The preview, the percentage and the cut-off warning all read this. */
  const sheets = createMemo(() => {
    const known = margins()
    // for a moment after the server's facts replaced the browser's, the selection may name pages that aren't there
    if (!known || options.selection.some(ref => !refs().includes(ref))) return undefined
    return layout({ source: source(), options, sheet: SHEET_SIZES[options.paper], margins: known[options.paper] })
  })
  /** Which sheet the person stepped to, counted from 0. It may point past the end after pages were left out. */
  const [step, setStep] = createSignal(0)
  /** The sheet in the preview, counted from 0: the one stepped to, or the last one there is. */
  const current = () => Math.max(0, Math.min(step(), (sheets()?.length ?? 1) - 1))
  const shown = () => sheets()?.[current()]
  /** What the preview shows and which sheet of how many it is, for one copy. */
  const sheetText = () => {
    const onSheet = shown()?.placements.map(placement => placement.ref)
    if (!onSheet?.length) return kind === "pdf" ? "Keine Seiten ausgewählt" : "Keine Fotos ausgewählt"
    const place = `${current() + 1}/${sheets()!.length}`
    if (kind === "photos") return `Foto ${place}`
    return `${onSheet.length === 1 ? "Seite" : "Seiten"} ${onSheet.join(" und ")} · ${place}`
  }
  const percent = () => {
    if (options.printSize.kind === "percent") return options.printSize.value
    const first = shown()?.placements[0]
    return first && Math.round(first.scale * 100)
  }
  /** What lies over the screen: the detailed controls behind "Ändern", or "Jetzt drucken?". */
  const [over, setOver] = createSignal<"details" | "confirmation">()
  /** A Print Job is cut off when any of its sheets is. */
  const cutOff = () => sheets()?.some(sheet => sheet.cutOff) ?? false

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
      if (kind === "pdf") o.rotation = quarterOn(o.rotation)
      else if (photo !== undefined) o.photoRotations = { ...o.photoRotations, [photo]: quarterOn(o.photoRotations?.[photo]) }
    })
  }

  /** Leaves a page or photo out, or brings it back to its place in the file's order. The preview goes to one brought back. */
  function toggle(ref: number) {
    const selected = options.selection.includes(ref)
    const selection = selected ? options.selection.filter(other => other !== ref) : [...options.selection, ref].sort((a, b) => a - b)
    setOptions(o => { o.selection = selection })
    if (!selected) setStep(Math.floor(selection.indexOf(ref) / (kind === "pdf" ? options.pagesPerSheet : 1)))
  }

  function select(selection: number[]) {
    setOptions(o => { o.selection = selection })
    setStep(0)
  }

  // The server's facts agree with the browser's, unless the browser read the file differently: then every
  // page or photo the server found is selected.
  createEffect(refs, (now, before) => {
    if (before && now.length !== before.length) select([...now])
  })

  return (
    <>
    {/* nothing behind an open dialog can be tapped or reached with the keyboard */}
    <main class="flex min-h-dvh flex-col gap-4 p-4" inert={over() !== undefined}>
      <div class="flex items-center gap-2">
        <button type="button" class="-ml-2 min-h-11 shrink-0 cursor-pointer rounded-lg px-2 font-semibold text-brand" onClick={() => props.onBack()}>
          <span aria-hidden="true">‹ </span>Zurück
        </button>
        <h1 class="truncate font-bold">{props.fileName}</h1>
      </div>
      <PresetChips presets={presets} options={options} onPick={apply} onOwn={() => setOver("details")} />
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
          source={kind === "pdf" ? { kind: "pdf", pdf: pdf() } : { kind: "photos", urls: photoUrls }}
          grey={options.color === "mono"}
          zoom={zoom()}
        />
        <Show when={sheets()}>
          {laidOut => <SheetSteps index={current()} count={laidOut().length} text={sheetText()} onChange={setStep} />}
        </Show>
      </div>
      <div class="flex flex-col gap-1">
        <PrintSize value={options.printSize} percent={percent()} onChange={printSize => setOptions(o => { o.printSize = printSize })} />
        <Show when={cutOff()}>
          <p role="alert" class="rounded-lg bg-[#fff1d6] px-3 py-2 text-sm text-[#7a4b00]">Achtung: Teile des Inhalts werden abgeschnitten.</p>
        </Show>
      </div>
      <div class="flex items-center justify-between gap-4">
        <span class="shrink-0">Position</span>
        <PositionGrid value={options.position} onChange={position => setOptions(o => { o.position = position })} />
      </div>
      <Thumbnails
        source={kind === "pdf" ? { kind: "pdf", pdf: pdf() } : { kind: "photos", urls: photoUrls }}
        refs={refs()}
        selection={options.selection}
        grey={options.color === "mono"}
        onToggle={toggle}
        onAll={() => select([...refs()])}
        onNone={() => select([])}
      />
      <SummaryLine kind={kind} total={refs().length} options={options} percent={percent()} onChange={() => setOver("details")} />
      <div class="sticky bottom-0 mt-auto bg-white py-3">
        {/* not before the layout is known: the confirmation says how many sheets, at what size, and whether something
            is cut off; and not before the upload is done, so that it says it from the server's facts */}
        <button
          type="button"
          class="btn-primary"
          disabled={props.uploading !== undefined || options.selection.length === 0 || !sheets()}
          onClick={() => setOver("confirmation")}
        >
          {props.uploading !== undefined
            ? `Wird hochgeladen … ${Math.min(99, Math.round(props.uploading * 100))} %`
            : options.selection.length > 0 ? "Drucken" : kind === "pdf" ? "Keine Seiten gewählt" : "Keine Fotos gewählt"}
        </button>
      </div>
    </main>
    <Show when={over() === "details"}>
      <OptionsDrawer
        options={options}
        kind={kind}
        presets={presets}
        onChange={changes => setOptions(o => { Object.assign(o, changes) })}
        onPickPreset={apply}
        onClose={() => setOver(undefined)}
      />
    </Show>
    {/* Drucken waits for the layout, so it is known here */}
    <Show when={over() === "confirmation" && sheets()}>
      {laidOut => (
        <Confirmation
          fileName={props.fileName}
          kind={kind}
          total={refs().length}
          options={options}
          sheets={sheetCount(laidOut(), options.copies)}
          percent={percent()}
          cutOff={cutOff()}
          onConfirm={() => props.onPrint(snapshot(options))}
          onBack={() => setOver(undefined)}
        />
      )}
    </Show>
    </>
  )
}
