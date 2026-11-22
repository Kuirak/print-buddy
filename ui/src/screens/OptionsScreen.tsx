import { createEffect, createMemo, createSignal, createStore, onSettled, Show, snapshot, untrack } from "solid-js"
import type { FileFacts, FileKind, PaperMargins } from "../../../shared/api.ts"
import { cells, landscapeFirst, layout, maxSheets, overSheetLimit, printableArea, sheetCount, SHEET_SIZES, type LayoutInput } from "../../../shared/layout.ts"
import { maxCount, minOwnSize, type FormatLayout, type Item, type Layout, type PrintOptions, type PrintSizeMode, type Rotation } from "../../../shared/print-options.ts"
import { isLoginExpired, readPrinter } from "../api.ts"
import { ChoiceGroup } from "../controls/ChoiceGroup.tsx"
import { Confirmation } from "../controls/Confirmation.tsx"
import { ItemBar } from "../controls/ItemBar.tsx"
import { formatChoices, gridChoices, LayoutStrip } from "../controls/LayoutStrip.tsx"
import { OptionsDrawer } from "../controls/OptionsDrawer.tsx"
import { PositionGrid } from "../controls/PositionGrid.tsx"
import { PresetChips } from "../controls/PresetChips.tsx"
import { Preview, type PreviewSource } from "../controls/Preview.tsx"
import { asSizeChoice, PrintSize } from "../controls/PrintSize.tsx"
import { SheetSteps } from "../controls/SheetSteps.tsx"
import { Stepper } from "../controls/Stepper.tsx"
import { Thumbnails } from "../controls/Thumbnails.tsx"
import { ToggleChip } from "../controls/ToggleChip.tsx"
import { ViewZoom } from "../controls/ViewZoom.tsx"
import { formatNames, itemName, lageNames, paperNames, sizeNames } from "../job-text.ts"
import { openPdf, type PdfPreview } from "../pdf-preview.ts"
import { createPresets, type Preset } from "../presets.ts"

const readPrinterAgainAfterMs = 2_000

/** More pages than this, and the pictures of a PDF only switch pages on and off. */
const onOffOnlyAbove = 30

const lagen = (["save", "portrait", "landscape"] as const).map(value => ({ value, label: lageNames[value] }))

/** A length in points as whole millimetres, rounded down. */
const wholeMm = (points: number) => Math.floor((points * 25.4) / 72)

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
  /** A PDF this long shows pictures that only switch its pages on and off: a counter for each would fill the screen. */
  const onOffOnly = () => kind === "pdf" && refs().length > onOffOnlyAbove
  createEffect(() => JSON.stringify(options), () => props.onChange(snapshot(options)))

  const [margins, setMargins] = createSignal<PaperMargins>()
  // what the preview draws: the PDF's pages through pdf.js, or the photos straight from the phone's copies
  const [pdf, setPdf] = createSignal<PdfPreview>()
  const photoUrls = kind === "photos" ? files.map(file => URL.createObjectURL(file)) : []
  /** What the preview, the thumbnails and the confirmation draw the pages or photos from. */
  const pictures = (): PreviewSource => (kind === "pdf" ? { kind: "pdf", pdf: pdf() } : { kind: "photos", urls: photoUrls })
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
  /**
   * Which sheet the person stepped to, counted from 0, or the page or photo whose first sheet to show once it is laid
   * out. A number may point past the end after pages were left out.
   */
  const [step, setStep] = createSignal<number | { first: number }>(0)
  /** The sheet in the preview, counted from 0: the one stepped to, or the last one there is. */
  const current = () => {
    const laidOut = sheets()
    const wanted = step()
    const index = typeof wanted === "number" ? wanted : (laidOut?.findIndex(sheet => sheet.placements.some(placement => placement.ref === wanted.first)) ?? 0)
    return Math.max(0, Math.min(index, (laidOut?.length ?? 1) - 1))
  }
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
  /**
   * The percentage on the shown sheet: the one given, or for Einpassen and Füllen read off its first page or photo that
   * has no size of its own, else off its first one.
   */
  const percent = () => {
    if (options.printSize.kind === "percent") return options.printSize.value
    const placements = shown()?.placements ?? []
    const read = placements.find(placement => options.items[refs().indexOf(placement.ref)]?.size === undefined) ?? placements[0]
    return read && Math.round(read.scale * 100)
  }
  /** What lies over the screen: the detailed controls behind "Einstellungen", or "Jetzt drucken?". */
  const [over, setOver] = createSignal<"details" | "confirmation">()
  /** A Print Job is cut off when any of its sheets is. */
  const cutOff = () => sheets()?.some(sheet => sheet.cutOff) ?? false
  /** The Print Job would take more paper than one may. */
  const tooMany = () => {
    const laidOut = sheets()
    return laidOut !== undefined && overSheetLimit(laidOut, options.copies)
  }

  /** The Photo format chosen, if one is. */
  const atFormat = (): FormatLayout | undefined => (options.layout.kind === "format" ? options.layout : undefined)
  /** The own size in mm of this Print Job: what "Eigenes" stands for, kept while another layout is chosen. */
  const [ownSize, setOwnSize] = createSignal({ w: 60, h: 90 })
  // whatever brings an own size (the inputs, a Preset, the Print Options from before the login) sets it for the tile too
  createEffect(
    () => {
      const format = atFormat()?.format
      return format !== undefined && typeof format !== "string" ? { w: format.w, h: format.h } : undefined
    },
    own => { if (own) setOwnSize(own) },
  )
  /** The layouts on offer: the grids, and for photos the Photo formats, which keep the Lage and switches chosen. */
  const layoutChoices = () => {
    if (kind === "pdf") return gridChoices
    const { lage, gap, cutLines } = atFormat() ?? { lage: "save", gap: true, cutLines: false }
    return [...gridChoices, ...formatChoices({ lage, gap, cutLines }, ownSize())]
  }
  function chooseLayout(chosen: Layout) {
    setOptions(o => {
      // a Photo format prints at Füllen, its default, or Einpassen: coming from a grid, or from a percentage, it starts at Füllen
      if (chosen.kind === "format" && (o.layout.kind === "grid" || o.printSize.kind === "percent")) o.printSize = { kind: "fill" }
      o.layout = chosen
    })
    setStep(0)
  }
  function setFormat(changes: Partial<Pick<FormatLayout, "lage" | "gap" | "cutLines">>) {
    setOptions(o => { if (o.layout.kind === "format") Object.assign(o.layout, changes) })
  }
  function setOwnSide(side: "w" | "h", mm: number) {
    const next = { ...ownSize(), [side]: mm }
    setOwnSize(next)
    setOptions(o => { if (o.layout.kind === "format" && typeof o.layout.format !== "string") o.layout.format = next })
  }
  /** The layout gives no slots on the paper: the format doesn't fit it. */
  const noSlots = () => {
    const known = margins()?.[options.paper]
    return known !== undefined && cells(options.layout, SHEET_SIZES[options.paper], known).cells.length === 0
  }
  /** What is wrong with the own size, in German, or `undefined` when it prints. */
  const ownProblem = () => {
    const format = atFormat()?.format
    if (format === undefined || typeof format === "string") return undefined
    if (!(format.w >= minOwnSize && format.h >= minOwnSize)) return `Breite und Höhe mindestens ${minOwnSize} mm.`
    if (!noSlots()) return undefined
    const sheet = SHEET_SIZES[options.paper]
    const edge = margins()![options.paper]
    // too large for the Lage chosen, but it fits lying the other way: that is what to change
    const fitting = (["portrait", "landscape"] as const).find(lage => cells({ ...atFormat()!, lage }, sheet, edge).cells.length > 0)
    if (fitting) return `Passt nur mit Lage ${lageNames[fitting]}.`
    const area = printableArea(sheet, edge)
    return `Zu groß für ${paperNames[options.paper]}: höchstens ${wholeMm(area.width)} × ${wholeMm(area.height)} mm.`
  }
  /** A named Photo format that doesn't fit the paper chosen after it, in German. */
  const formatProblem = () => {
    const format = atFormat()?.format
    return typeof format === "string" && noSlots() ? `${formatNames[format]} passt nicht auf ${paperNames[options.paper]}.` : undefined
  }

  /** Sets what the Preset stores. How often each page or photo prints, and how it is turned, stay as they are. */
  function apply(preset: Preset) {
    presets.pick(preset)
    setOptions(o => {
      Object.assign(o, structuredClone(preset.values))
      for (const item of o.items) delete item.pan
    })
  }

  /** The page or photo picked by a tap in the preview (its `ref`): the bar under the preview changes it alone. */
  const [picked, setPicked] = createSignal<number>()
  const pickedItem = () => {
    const index = refs().indexOf(picked() ?? -1)
    return index < 0 ? undefined : options.items[index]
  }
  // one that is left out has nothing left to change
  createEffect(() => pickedItem()?.count ?? 0, count => { if (count === 0) setPicked(undefined) })
  /** A quarter turn of the picked page or photo, on top of the turn it gets by itself. */
  function turnPicked(by: 90 | 270) {
    const index = refs().indexOf(picked()!)
    setOptions(o => { o.items[index]!.turn = ((o.items[index]!.turn + by) % 360) as Rotation })
  }
  /** What the picked page or photo prints at: its own size, or the size for all. */
  const pickedSize = () => {
    const own = pickedItem()?.size
    if (own) return own
    return options.printSize.kind === "percent" ? undefined : options.printSize.kind
  }
  /** Füllen becomes Einpassen; anything else becomes Füllen. For the picked page or photo only. */
  function switchPickedSize() {
    const index = refs().indexOf(picked()!)
    const size = pickedSize() === "fill" ? "fit" : "fill"
    setOptions(o => {
      o.items[index]!.size = size
      delete o.items[index]!.pan
    })
  }
  /** Moves the page or photo where it overlaps the border: the axes of its `pan` that changed (see `Item.pan`). */
  function panItem(ref: number, pan: { x?: number; y?: number }) {
    const index = refs().indexOf(ref)
    setOptions(o => { o.items[index]!.pan = { ...o.items[index]!.pan, ...pan } })
  }
  /** "Größe für alle": the Print size for every page or photo; the sizes they had of their own go. */
  function setSizeForAll(printSize: PrintSizeMode) {
    setOptions(o => {
      o.printSize = printSize
      for (const item of o.items) {
        delete item.size
        delete item.pan
      }
    })
  }
  /** The sizes in use while the printed pages or photos differ, or `undefined` while they are all the same. */
  const mixedSizes = () => {
    const forAll = asSizeChoice(options.printSize)
    const used = new Set(options.items.filter(item => item.count > 0).map(item => item.size ?? forAll))
    return used.size > 1 ? [...used].filter(size => size !== undefined) : undefined
  }

  /** How often a page or photo prints: 0 leaves it out, up to `maxCount`. The preview goes to the first sheet of one brought back. */
  function setCount(ref: number, count: number) {
    const index = refs().indexOf(ref)
    const next = Math.max(0, Math.min(maxCount, count))
    const back = options.items[index]!.count === 0 && next > 0
    setOptions(o => { o.items[index]!.count = next })
    if (back) setStep({ first: ref })
  }

  /** "Alle gleich": every page or photo that prints, prints `count` times. None is switched on or off. */
  function setAll(count: number) {
    setOptions(o => {
      for (const item of o.items) if (item.count > 0) item.count = count
    })
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
    <main
      // a phone gets one column; from 1024 px the preview stands on the left and stays, while the controls scroll on the right
      class="flex min-h-dvh flex-col gap-3 px-4 pt-2 lg:grid lg:grid-cols-2 lg:grid-rows-[auto_1fr] lg:items-start lg:gap-x-8"
      inert={over() !== undefined}
      // touching any control but the preview and the bar under it ends the bar
      onPointerDown={event => { if (!(event.target as Element).closest("[data-picks]")) setPicked(undefined) }}
    >
      <div class="flex min-w-0 flex-col gap-3 lg:col-start-2 lg:row-start-1">
      <div class="flex items-center gap-1">
        <button type="button" class="-ml-2 min-h-11 shrink-0 cursor-pointer rounded-lg px-2 font-semibold text-brand" onClick={() => props.onBack()}>
          <span aria-hidden="true">‹ </span>Zurück
        </button>
        <h1 class="truncate font-bold">{props.fileName}</h1>
      </div>
      <PresetChips presets={presets} options={options} onPick={apply} onOwn={() => setOver("details")} />
      </div>
      <div class="flex min-w-0 flex-col gap-2 lg:sticky lg:top-2 lg:col-start-1 lg:row-span-2 lg:row-start-1">
        <div class="flex items-center justify-between gap-2">
          {/* copies, colour, paper, quality and the Preset actions */}
          <button
            type="button"
            class="min-h-10 cursor-pointer rounded-lg border border-gray-300 px-3 py-1.5 font-semibold"
            onClick={() => setOver("details")}
          >
            Einstellungen
          </button>
          <ViewZoom value={zoom()} onChange={setZoom} />
        </div>
        <div data-picks>
          <Preview
            paper={SHEET_SIZES[options.paper]}
            margins={margins()?.[options.paper]}
            sheet={shown()}
            source={pictures()}
            grey={options.color === "mono"}
            zoom={zoom()}
            index={current()}
            count={sheets()?.length ?? 0}
            onStep={setStep}
            picked={picked()}
            turned={ref => (options.items[refs().indexOf(ref)]?.turn ?? 0) !== 0}
            onPick={setPicked}
            onPan={panItem}
          />
        </div>
        {/* one row of fixed height: the bar of the picked page or photo, or the stepper; nothing to step through on a
            single sheet, and with nothing selected it says so. Whichever shows, nothing below it moves. */}
        <div data-picks class="flex h-14 items-center justify-center">
          <Show
            when={picked() !== undefined}
            fallback={
              <Show when={sheets()?.length !== 1 && sheets()}>
                {laidOut => <SheetSteps index={current()} count={laidOut().length} text={sheetText()} onChange={setStep} />}
              </Show>
            }
          >
            <ItemBar
              name={itemName(kind, picked()!)}
              size={pickedSize() ? sizeNames[pickedSize()!] : `${percent()} %`}
              onTurn={turnPicked}
              onSize={switchPickedSize}
              onClose={() => setPicked(undefined)}
            />
          </Show>
        </div>
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-3 lg:col-start-2 lg:row-start-2 lg:self-stretch">
      {/* Größe für alle and Position side by side, right under the preview: on a phone the sheet stays on the screen
          while they change it, which only the preview shows */}
      <div class="flex items-start justify-between gap-3">
        <div class="flex min-w-0 flex-col gap-1">
          <span class="text-xs font-semibold text-muted">Größe für alle</span>
          <PrintSize
            value={options.printSize}
            choices={kind === "pdf" ? ["fit", "fill", "100"] : atFormat() ? ["fill", "fit"] : ["fill", "fit", "100"]}
            steps={kind === "pdf"}
            mixed={mixedSizes()}
            percent={percent()}
            onChange={setSizeForAll}
          />
        </div>
        <div class="flex shrink-0 flex-col items-center gap-1">
          <span class="text-xs font-semibold text-muted">Position</span>
          <PositionGrid
            value={options.position}
            onChange={position => setOptions(o => {
              o.position = position
              // Position decides again where the content lies
              for (const item of o.items) delete item.pan
            })}
          />
        </div>
      </div>
      <Show when={cutOff()}>
        <p role="alert" class="rounded-lg bg-[#fff1d6] px-3 py-2 text-sm text-[#7a4b00]">Achtung: Teile des Inhalts werden abgeschnitten.</p>
      </Show>
      <LayoutStrip
        choices={layoutChoices()}
        value={options.layout}
        paper={SHEET_SIZES[options.paper]}
        margins={margins()?.[options.paper]}
        landscape={landscapeFirst(source(), options.items)}
        onChange={chooseLayout}
      />
      {/* one own size per Print Job, in mm */}
      <Show when={atFormat() && typeof atFormat()!.format !== "string"}>
        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-2">
            <label class="flex items-center gap-1">
              Breite
              <input
                type="number"
                inputmode="numeric"
                class="w-20 rounded-lg border border-gray-300 p-2"
                value={ownSize().w}
                onInput={event => setOwnSide("w", event.currentTarget.valueAsNumber)}
              />
            </label>
            <span aria-hidden="true">×</span>
            <label class="flex items-center gap-1">
              Höhe
              <input
                type="number"
                inputmode="numeric"
                class="w-20 rounded-lg border border-gray-300 p-2"
                value={ownSize().h}
                onInput={event => setOwnSide("h", event.currentTarget.valueAsNumber)}
              />
            </label>
            <span>mm</span>
          </div>
          <Show when={ownProblem()}>
            {problem => <p role="alert" class="text-sm font-semibold text-[#b3261e]">{problem()}</p>}
          </Show>
        </div>
      </Show>
      {/* a single page or photo has no pictures to choose from, only how often it prints */}
      <Show
        when={refs().length > 1}
        fallback={
          <div class="flex items-center justify-between gap-3">
            <span class="font-semibold">Wie oft</span>
            <Stepper
              label="Wie oft"
              decreaseLabel="Seltener"
              increaseLabel="Öfter"
              value={options.items[0]?.count ?? 1}
              min={1}
              max={maxCount}
              unit="×"
              onChange={count => setOptions(o => { o.items[0]!.count = count })}
              compact
            />
          </div>
        }
      >
        <Thumbnails
          source={pictures()}
          refs={refs()}
          counts={options.items.map(item => item.count)}
          onOffOnly={onOffOnly()}
          grey={options.color === "mono"}
          onCount={setCount}
          onAll={setAll}
        />
      </Show>
      {/* how the photos lie at a Photo format, and what helps cutting them apart */}
      <Show when={atFormat()}>
        {format => (
          <div class="flex flex-col gap-3">
            <div class="flex flex-col gap-1">
              <span class="text-xs font-semibold text-muted">Lage der Fotos</span>
              <ChoiceGroup label="Lage der Fotos" choices={lagen} value={format().lage} onChange={lage => setFormat({ lage })} compact />
            </div>
            <div class="flex flex-wrap gap-2">
              <ToggleChip label="Abstand zum Schneiden" state={format().gap ? "on" : "off"} onChange={gap => setFormat({ gap })} />
              <ToggleChip label="Schnittlinien" state={format().cutLines ? "on" : "off"} onChange={cutLines => setFormat({ cutLines })} />
            </div>
          </div>
        )}
      </Show>
      {/* the last thing on the screen, so that at the end of the page nothing lies under it */}
      <div class="sticky bottom-0 z-10 -mx-4 mt-auto border-t border-gray-200 bg-white px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {/* not before the layout is known: the confirmation says how many sheets, at what size, and whether something
            is cut off; and not before the upload is done, so that it says it from the server's facts */}
        <button
          type="button"
          class="btn-primary"
          disabled={props.uploading !== undefined || printed().length === 0 || !sheets() || tooMany() || noSlots() || ownProblem() !== undefined}
          onClick={() => setOver("confirmation")}
        >
          {props.uploading !== undefined
            ? `Wird hochgeladen … ${Math.min(99, Math.round(props.uploading * 100))} %`
            : printed().length > 0 ? "Drucken" : kind === "pdf" ? "Keine Seiten gewählt" : "Keine Fotos gewählt"}
        </button>
        <Show when={tooMany() ? `Höchstens ${maxSheets} Blätter pro Druck.` : formatProblem()}>
          {reason => <p role="alert" class="pt-1 text-center text-sm font-semibold text-[#b3261e]">{reason()}</p>}
        </Show>
      </div>
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
          kind={kind}
          source={pictures()}
          refs={refs()}
          options={options}
          sheetsPerCopy={laidOut().length}
          sheets={sheetCount(laidOut(), options.copies)}
          overLimit={tooMany()}
          maxSheets={maxSheets}
          paper={SHEET_SIZES[options.paper]}
          cells={cells(options.layout, SHEET_SIZES[options.paper], margins()![options.paper], landscapeFirst(source(), options.items)).cells.map(cell => cell.box)}
          percent={percent()}
          mixedSizes={mixedSizes() !== undefined}
          cutOff={cutOff()}
          onConfirm={() => props.onPrint(snapshot(options))}
          onBack={() => setOver(undefined)}
        />
      )}
    </Show>
    </>
  )
}
