import { createEffect, createMemo, createSignal, createStore, onSettled, Show, snapshot, untrack } from "solid-js"
import type { FileFacts, FileKind, PaperMargins } from "../../../shared/api.ts"
import { cells, landscapeFirst, layout, sheetCount, SHEET_SIZES, type LayoutInput } from "../../../shared/layout.ts"
import type { Item, PrintOptions, Rotation } from "../../../shared/print-options.ts"
import { isLoginExpired, readPrinter } from "../api.ts"
import { Confirmation } from "../controls/Confirmation.tsx"
import { gridChoices, LayoutStrip } from "../controls/LayoutStrip.tsx"
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

const noMargins = { top: 0, right: 0, bottom: 0, left: 0 }

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
  /** Every page of the PDF, counted from 1, or every photo, counted from 0, in the order of `options.items`: what the thumbnails show. */
  const refs = createMemo(() => {
    const known = source()
    return known.kind === "pdf" ? known.pages.map((_, index) => index + 1) : known.photos.map((_, index) => index)
  })
  /** Each page or photo once, printed once, unturned. */
  const everyOnce = () => refs().map((): Item => ({ count: 1, turn: 0 }))
  // a new file starts from the starred Preset, never from the Print Options of the job before, with every page or photo printed once
  const [options, setOptions] = createStore<PrintOptions>(structuredClone(untrack(() => props.initial)) ?? {
    ...structuredClone(presets.starred().values),
    items: untrack(everyOnce),
  })
  /** The pages or photos that print, as `refs` counts them. */
  const printed = () => refs().filter((_, index) => (options.items[index]?.count ?? 0) > 0)
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
    // for a moment after the server's facts replaced the browser's, the items may not match the pages
    if (!known || options.items.length !== refs().length) return undefined
    return layout({ source: source(), options, sheet: SHEET_SIZES[options.paper], margins: known[options.paper] })
  })
  /** Which sheet the person stepped to, counted from 0. It may point past the end after pages were left out. */
  const [step, setStep] = createSignal(0)
  /** The sheet in the preview, counted from 0: the one stepped to, or the last one there is. */
  const current = () => Math.max(0, Math.min(step(), (sheets()?.length ?? 1) - 1))
  const shown = () => sheets()?.[current()]
  /** What the preview shows and which sheet of how many it is, for one copy: its page or photo, two pages by number, or else just the sheet. */
  const sheetText = () => {
    const onSheet = shown()?.placements.map(placement => placement.ref)
    if (!onSheet?.length) return kind === "pdf" ? "Keine Seiten ausgewählt" : "Keine Fotos ausgewählt"
    const place = `${current() + 1}/${sheets()!.length}`
    if (onSheet.length === 1) return kind === "photos" ? `Foto ${place}` : `Seite ${onSheet[0]} · ${place}`
    if (kind === "pdf" && onSheet.length === 2 && onSheet[0] !== onSheet[1]) return `Seiten ${onSheet.join(" und ")} · ${place}`
    return `Blatt ${place}`
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

  /** Sets what the Preset stores. How often each page or photo prints, and how it is turned, stay as they are. */
  function apply(preset: Preset) {
    presets.pick(preset)
    setOptions(o => { Object.assign(o, structuredClone(preset.values)) })
  }

  /** A quarter turn clockwise: of every page of the PDF, or of the photo in the preview. */
  function turn() {
    const photo = shown()?.placements[0]?.ref
    setOptions(o => {
      for (const [index, item] of o.items.entries()) {
        if (kind === "pdf" || index === photo) item.turn = ((item.turn + 90) % 360) as Rotation
      }
    })
  }

  /** Leaves a page or photo out, or brings it back to its place in the file's order. The preview goes to one brought back. */
  function toggle(ref: number) {
    const index = refs().indexOf(ref)
    const back = options.items[index]!.count === 0
    const items = options.items.map((item, at) => (at === index ? { ...item, count: back ? 1 : 0 } : item))
    setOptions(o => { o.items[index]!.count = back ? 1 : 0 })
    if (!back) return
    // its first appearance follows every appearance of the pages or photos before it
    const before = items.slice(0, index).reduce((sum, item) => sum + item.count, 0)
    const perSheet = cells(options.layout, SHEET_SIZES[options.paper], margins()?.[options.paper] ?? noMargins, landscapeFirst(source(), items)).cells.length
    setStep(Math.floor(before / Math.max(1, perSheet)))
  }

  /** Prints every page or photo once (`count` 1), or none of them (`count` 0). */
  function select(count: 0 | 1) {
    setOptions(o => { for (const item of o.items) item.count = count })
    setStep(0)
  }

  // The server's facts agree with the browser's, unless the browser read the file differently: then every
  // page or photo the server found prints once.
  createEffect(refs, (now, before) => {
    if (before && now.length !== before.length) {
      setOptions(o => { o.items = everyOnce() })
      setStep(0)
    }
  })

  return (
    <>
    {/* nothing behind an open dialog can be tapped or reached with the keyboard */}
    <main class="flex min-h-dvh flex-col gap-3 px-4 pt-2" inert={over() !== undefined}>
      <div class="flex items-center gap-1">
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
            class="min-h-10 cursor-pointer rounded-lg border border-gray-300 px-3 py-1.5 font-semibold disabled:cursor-default disabled:opacity-40"
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
          index={current()}
          count={sheets()?.length ?? 0}
          onStep={setStep}
        />
        {/* nothing to step through on a single sheet; with nothing selected it says so */}
        <Show when={sheets()?.length !== 1 && sheets()}>
          {laidOut => <SheetSteps index={current()} count={laidOut().length} text={sheetText()} onChange={setStep} />}
        </Show>
      </div>
      <LayoutStrip
        choices={gridChoices}
        value={options.layout}
        paper={SHEET_SIZES[options.paper]}
        margins={margins()?.[options.paper]}
        landscape={landscapeFirst(source(), options.items)}
        onChange={chosen => {
          setOptions(o => { o.layout = chosen })
          setStep(0)
        }}
      />
      {/* Print size and Position side by side, so that both fit on the screen with the preview */}
      <div class="flex items-start justify-between gap-3">
        <div class="flex min-w-0 flex-col gap-1">
          <span class="text-xs font-semibold text-muted">Druckgröße</span>
          <PrintSize value={options.printSize} percent={percent()} onChange={printSize => setOptions(o => { o.printSize = printSize })} />
        </div>
        <div class="flex shrink-0 flex-col items-center gap-1">
          <span class="text-xs font-semibold text-muted">Position</span>
          <PositionGrid value={options.position} onChange={position => setOptions(o => { o.position = position })} />
        </div>
      </div>
      <Show when={cutOff()}>
        <p role="alert" class="rounded-lg bg-[#fff1d6] px-3 py-2 text-sm text-[#7a4b00]">Achtung: Teile des Inhalts werden abgeschnitten.</p>
      </Show>
      {/* a single page or photo leaves nothing to choose */}
      <Show when={refs().length > 1}>
        <Thumbnails
          source={kind === "pdf" ? { kind: "pdf", pdf: pdf() } : { kind: "photos", urls: photoUrls }}
          refs={refs()}
          selection={printed()}
          grey={options.color === "mono"}
          onToggle={toggle}
          onAll={() => select(1)}
          onNone={() => select(0)}
        />
      </Show>
      <SummaryLine kind={kind} total={refs().length} options={options} percent={percent()} onChange={() => setOver("details")} />
      {/* the last thing on the screen, so that at the end of the page nothing lies under it */}
      <div class="sticky bottom-0 z-10 -mx-4 mt-auto border-t border-gray-200 bg-white px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {/* not before the layout is known: the confirmation says how many sheets, at what size, and whether something
            is cut off; and not before the upload is done, so that it says it from the server's facts */}
        <button
          type="button"
          class="btn-primary"
          disabled={props.uploading !== undefined || printed().length === 0 || !sheets()}
          onClick={() => setOver("confirmation")}
        >
          {props.uploading !== undefined
            ? `Wird hochgeladen … ${Math.min(99, Math.round(props.uploading * 100))} %`
            : printed().length > 0 ? "Drucken" : kind === "pdf" ? "Keine Seiten gewählt" : "Keine Fotos gewählt"}
        </button>
      </div>
    </main>
    <Show when={over() === "details"}>
      <OptionsDrawer
        options={options}
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
