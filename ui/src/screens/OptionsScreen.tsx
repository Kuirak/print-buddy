import { createEffect, createMemo, createSignal, onSettled, Show, untrack } from "solid-js"
import { maxPhotos, type FileFacts, type FileKind, type PaperMargins } from "../../../shared/api.ts"
import { maxSheets, SHEET_SIZES } from "../../../shared/layout.ts"
import { maxCount, minOwnSize, type FormatLayout, type PrintOptions } from "../../../shared/print-options.ts"
import { isLoginExpired, readPrinter } from "../api.ts"
import { ChoiceGroup } from "../controls/ChoiceGroup.tsx"
import { Confirmation } from "../controls/Confirmation.tsx"
import { WarningIcon } from "../controls/Icons.tsx"
import { ItemBar } from "../controls/ItemBar.tsx"
import { formatChoices, gridChoices, LayoutStrip } from "../controls/LayoutStrip.tsx"
import { OptionsDrawer } from "../controls/OptionsDrawer.tsx"
import { PositionGrid } from "../controls/PositionGrid.tsx"
import { PresetChips } from "../controls/PresetChips.tsx"
import { Preview, type PreviewSource } from "../controls/Preview.tsx"
import { PrintSize } from "../controls/PrintSize.tsx"
import { SheetSteps } from "../controls/SheetSteps.tsx"
import { Stepper } from "../controls/Stepper.tsx"
import { Thumbnails } from "../controls/Thumbnails.tsx"
import { ToggleChip } from "../controls/ToggleChip.tsx"
import { ViewZoom } from "../controls/ViewZoom.tsx"
import { formatNames, itemName, lageNames, paperNames, sizeNames } from "../job-text.ts"
import { openPdf, type PdfPreview } from "../pdf-preview.ts"
import { createPresets, type Preset } from "../presets.ts"
import { derive, edit, startEditing, type Edit, type Edited } from "../print-options-editor.ts"

const readPrinterAgainAfterMs = 2_000

/** More pages than this, and the pictures of a PDF only switch pages on and off. */
const onOffOnlyAbove = 30

const lagen = (["save", "portrait", "landscape"] as const).map(value => ({ value, label: lageNames[value] }))

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
  /**
   * "Fotos hinzufügen", photos only: more photos after these, with the Print Options as they are now. Every photo
   * already there keeps where it is and what was chosen for it.
   */
  onAddPhotos?: (files: File[], options: PrintOptions) => void
  /** "Zurück": the person gives the job up. */
  onBack: () => void
}) {
  const presets = createPresets(untrack(() => props.kind))
  // the files never change while their options screen is open
  const files = untrack(() => props.files)
  /** A PDF or photos, as the layout module names them. The facts can't change it: the server refuses a file of the other type. */
  const kind = untrack(() => props.kind) === "pdf" ? "pdf" : "photos"
  // a new file starts from the starred Preset, never from the Print Options of the job before, with every page or photo printed once
  const [editing, setEditing] = createSignal(startEditing(untrack(() => props.facts), untrack(() => props.initial) ?? presets.starred().values))
  /** The Print Options as they are now. The editor never changes them in place: each edit gives new ones. */
  const options = () => editing().options
  const [margins, setMargins] = createSignal<PaperMargins>()
  /** Everything that follows from the Print Options, from the editor: the sheets or why they can't print, the percentage and so on. */
  const derived = createMemo(() => derive(editing(), margins()))
  /** Every page of the PDF, counted from 1, or every photo, counted from 0: what the thumbnails show. */
  const refs = () => derived().refs
  /** A PDF this long shows pictures that only switch its pages on and off: a counter for each would fill the screen. */
  const onOffOnly = () => kind === "pdf" && refs().length > onOffOnlyAbove
  createEffect(() => JSON.stringify(options()), () => props.onChange(untrack(options)))
  /** Applies an edit of the Print Options, on top of any edit not yet shown, and goes to the sheet the editor says. */
  function change(next: Edit) {
    let edited!: Edited
    setEditing(before => (edited = edit(before, next)).editing)
    const { show } = edited
    if (show === "first") setStep(0)
    else if (show) setStep({ first: show.ref })
  }
  // the server's facts, once the upload is done, in place of the browser's
  createEffect(() => props.facts, (facts, before) => { if (before) change({ kind: "facts", facts }) })

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
  /** The sheets the preview draws, from the editor: see `derive`. */
  const sheets = () => derived().sheets
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
  /** The percentage on the shown sheet. */
  const percent = () => derived().percent(current())
  /** What lies over the screen: the detailed controls behind "Einstellungen", or "Jetzt drucken?". */
  const [over, setOver] = createSignal<"details" | "confirmation">()

  /** The Photo format chosen, if one is. */
  const atFormat = (): FormatLayout | undefined => {
    const { layout } = options()
    return layout.kind === "format" ? layout : undefined
  }
  /** The layouts on offer: the grids, and for photos the Photo formats, with the Lage and switches a format starts with. */
  const layoutChoices = () => (kind === "pdf" ? gridChoices : [...gridChoices, ...formatChoices(derived().formatSwitches, editing().ownSize)])
  /** What is wrong with the own size, in German, said under Breite and Höhe; `undefined` while nothing is. */
  const ownProblem = () => {
    const known = derived().unprintable
    if (known?.reason === "own-size-too-small") return `Breite und Höhe mindestens ${minOwnSize} mm.`
    if (known?.reason !== "no-cells" || typeof atFormat()?.format === "string") return undefined
    // too large for the Lage chosen, but it fits lying the other way: that is what to change
    if (known.otherLage) return `Passt nur mit Lage ${lageNames[known.otherLage]}.`
    return `Zu groß für ${paperNames[options().paper]}: höchstens ${known.printable.w} × ${known.printable.h} mm.`
  }

  /** Picks a Preset: it is marked, and the editor sets what it stores. */
  function apply(preset: Preset) {
    presets.pick(preset)
    change({ kind: "preset", values: preset.values })
  }

  /** The page or photo picked by a tap in the preview (its `ref`): the bar under the preview changes it alone. */
  const [picked, setPicked] = createSignal<number>()
  const pickedItem = () => {
    const ref = picked()
    return ref === undefined ? undefined : derived().itemOf(ref)
  }
  // one that is left out has nothing left to change
  createEffect(() => pickedItem()?.count ?? 0, count => { if (count === 0) setPicked(undefined) })
  /** What the picked page or photo prints at: its own size, or the size for all. */
  const pickedSize = () => derived().sizeOf(picked()!)
  /** The photos picked with "Fotos hinzufügen" were more than the Print Job has room for: none was added. */
  const [tooManyAdded, setTooManyAdded] = createSignal(false)
  /**
   * The one line under Drucken, in German: the sheet limit, then photos added beyond room, then a Photo format the
   * paper can't take. Nothing printed has no line, Drucken itself says it; items that don't match aren't laid out yet.
   */
  const underDrucken = () => {
    const format = atFormat()?.format
    if (derived().overLimit) return `Höchstens ${maxSheets} Blätter pro Druck.`
    if (tooManyAdded()) return `Höchstens ${maxPhotos} Fotos auf einmal: noch ${maxPhotos - files.length} möglich.`
    if (derived().unprintable?.reason === "no-cells" && typeof format === "string") return `${formatNames[format]} passt nicht auf ${paperNames[options().paper]}.`
    return undefined
  }

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
        <h1 class="truncate font-sans font-extrabold">{props.fileName}</h1>
      </div>
      <PresetChips presets={presets} options={options()} onPick={apply} onOwn={() => setOver("details")} />
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
        <div data-picks class="relative">
          <Preview
            paper={SHEET_SIZES[options().paper]}
            margins={margins()?.[options().paper]}
            sheet={shown()}
            source={pictures()}
            grey={options().color === "mono"}
            zoom={zoom()}
            index={current()}
            count={sheets()?.length ?? 0}
            onStep={setStep}
            picked={picked()}
            turned={ref => (derived().itemOf(ref)?.turn ?? 0) !== 0}
            onPick={setPicked}
            onPan={(ref, pan) => change({ kind: "pan", ref, pan })}
          />
          {/* with nothing selected the sheet is empty; a note says how to bring a page or photo back */}
          <Show when={derived().printed.length === 0}>
            <p class="note scribble pointer-events-none absolute inset-x-8 top-1/2 z-10 -translate-y-1/2 -rotate-2 bg-note-yellow text-center shadow-md">
              {kind === "pdf" ? "Tippe unten auf eine Seite." : "Tippe unten auf ein Foto."}
            </p>
          </Show>
        </div>
        {/* one row of fixed height: the bar of the picked page or photo, or the stepper, at the bottom; nothing to step
            through on a single sheet. The strip above them stays free for the note on what is cut off. Whichever shows,
            nothing below it moves. */}
        <div data-picks class="relative flex h-16 items-end justify-center">
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
              onTurn={by => change({ kind: "turn", ref: picked()!, by })}
              onSize={() => change({ kind: "switch-size", ref: picked()! })}
              onClose={() => setPicked(undefined)}
            />
          </Show>
          {/* what is cut off: a small sticky note centred in the white between the preview and the stepper, covering
              neither. The strip is the row's free top plus the gap above the row. The bar of a picked page or photo is
              taller and takes the strip, so the note is only made see-through then: it stays in the page, and a screen
              reader hears it when the cut-off begins, not again when the bar closes. The sentence is short enough for
              one line from 320 px up; the icon says "Achtung". */}
          <Show when={derived().cutOff}>
            <div class={`pointer-events-none absolute inset-x-0 -top-2 flex h-8 items-center justify-center ${picked() === undefined ? "" : "opacity-0"}`}>
              <p role="alert" class="flex w-fit max-w-full -rotate-[0.5deg] items-center gap-1.5 rounded-sm bg-note-yellow px-2 py-0.5 text-[11px] leading-tight font-bold text-ink shadow-sm">
                <WarningIcon class="size-3.5 shrink-0" />
                Teile des Inhalts werden abgeschnitten.
              </p>
            </div>
          </Show>
        </div>
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-3 lg:col-start-2 lg:row-start-2 lg:self-stretch">
      {/* Größe für alle and Position side by side, right under the preview: on a phone the sheet stays on the screen
          while they change it, which only the preview shows */}
      <div class="note flex items-start justify-between gap-3 bg-note-sky">
        <div class="flex min-w-0 flex-col gap-1">
          <span class="text-xs font-semibold text-muted">Größe für alle</span>
          <PrintSize
            value={options().printSize}
            choices={kind === "pdf" ? ["fit", "fill", "100"] : atFormat() ? ["fill", "fit"] : ["fill", "fit", "100"]}
            steps={kind === "pdf"}
            mixed={derived().mixedSizes}
            percent={percent()}
            onChange={printSize => change({ kind: "size-for-all", printSize })}
          />
        </div>
        <div class="flex shrink-0 flex-col items-center gap-1">
          <span class="text-xs font-semibold text-muted">Position</span>
          <PositionGrid
            value={options().position}
            onChange={position => change({ kind: "position", position })}
          />
        </div>
      </div>
      <LayoutStrip
        choices={layoutChoices()}
        value={options().layout}
        paper={SHEET_SIZES[options().paper]}
        margins={margins()?.[options().paper]}
        landscape={derived().landscape}
        onChange={layout => change({ kind: "layout", layout })}
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
                value={editing().ownSize.w}
                onInput={event => change({ kind: "own-size", side: "w", mm: event.currentTarget.valueAsNumber })}
              />
            </label>
            <span aria-hidden="true">×</span>
            <label class="flex items-center gap-1">
              Höhe
              <input
                type="number"
                inputmode="numeric"
                class="w-20 rounded-lg border border-gray-300 p-2"
                value={editing().ownSize.h}
                onInput={event => change({ kind: "own-size", side: "h", mm: event.currentTarget.valueAsNumber })}
              />
            </label>
            <span>mm</span>
          </div>
          <Show when={ownProblem()}>
            {text => <p role="alert" class="text-sm font-semibold text-[#b3261e]">{text()}</p>}
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
              value={options().items[0]?.count ?? 1}
              min={1}
              max={maxCount}
              unit="×"
              onChange={count => change({ kind: "repeats", ref: refs()[0]!, count })}
              compact
            />
          </div>
        }
      >
        <Thumbnails
          source={pictures()}
          refs={refs()}
          counts={options().items.map(item => item.count)}
          onOffOnly={onOffOnly()}
          grey={options().color === "mono"}
          onCount={(ref, count) => change({ kind: "repeats", ref, count })}
          onAll={count => change({ kind: "all-same", count })}
        />
      </Show>
      {/* how the photos lie at a Photo format, and what helps cutting them apart */}
      <Show when={atFormat()}>
        {format => (
          <div class="flex flex-col gap-3">
            <div class="flex flex-col gap-1">
              <span class="text-xs font-semibold text-muted">Lage der Fotos</span>
              <ChoiceGroup label="Lage der Fotos" choices={lagen} value={format().lage} onChange={lage => change({ kind: "format-switches", changes: { lage } })} compact />
            </div>
            <div class="flex flex-wrap gap-2">
              <ToggleChip label="Abstand zum Schneiden" state={format().gap ? "on" : "off"} onChange={gap => change({ kind: "format-switches", changes: { gap } })} />
              <ToggleChip label="Schnittlinien" state={format().cutLines ? "on" : "off"} onChange={cutLines => change({ kind: "format-switches", changes: { cutLines } })} />
            </div>
          </div>
        )}
      </Show>
      {/* the last thing on the screen, so that at the end of the page nothing lies under it. "Fotos hinzufügen" sits
          beside Drucken: under the thumb wherever the person has scrolled to, and never over the preview */}
      <div class="sticky bottom-0 z-10 -mx-4 mt-auto border-t border-gray-200 bg-white px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div class="flex gap-2">
          {/* more photos after the ones there, up to as many as one Print Job holds */}
          <Show when={kind === "photos" && props.onAddPhotos && files.length < maxPhotos}>
            <label class="flex min-h-14 w-16 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-gray-300 bg-white text-[13px] font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand">
              {/* a picture with a plus: one more photo */}
              <svg aria-hidden="true" viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M16 5h6M19 2v6" />
                <path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5" />
                <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
                <circle cx="9" cy="9" r="2" />
              </svg>
              Fotos
              <input
                type="file"
                aria-label="Fotos hinzufügen"
                accept="image/jpeg,image/png"
                multiple
                class="sr-only"
                onChange={event => {
                  const added = [...(event.currentTarget.files ?? [])]
                  // empty the field, so that picking the same photo again counts as a change
                  event.currentTarget.value = ""
                  if (added.length === 0) return
                  if (files.length + added.length > maxPhotos) setTooManyAdded(true)
                  else props.onAddPhotos!(added, options())
                }}
              />
            </label>
          </Show>
          {/* not before the layout is known: the confirmation says how many sheets, at what size, and whether something
              is cut off; and not before the upload is done, so that it says it from the server's facts */}
          <button
            type="button"
            class="btn-primary min-h-14 min-w-0 flex-1"
            disabled={props.uploading !== undefined || derived().unprintable !== undefined || !sheets()}
            onClick={() => setOver("confirmation")}
          >
            {props.uploading !== undefined
              ? `Wird hochgeladen … ${Math.min(99, Math.round(props.uploading * 100))} %`
              : derived().printed.length > 0 ? "Drucken" : kind === "pdf" ? "Keine Seiten gewählt" : "Keine Fotos gewählt"}
          </button>
        </div>
        <Show when={underDrucken()}>
          {reason => <p role="alert" class="pt-1 text-center text-sm font-semibold text-[#b3261e]">{reason()}</p>}
        </Show>
      </div>
      </div>
    </main>
    <Show when={over() === "details"}>
      <OptionsDrawer
        options={options()}
        presets={presets}
        onChange={changes => change({ kind: "details", changes })}
        onPickPreset={apply}
        onClose={() => setOver(undefined)}
      />
    </Show>
    {/* Drucken waits for the layout, so it is known here */}
    <Show when={over() === "confirmation" && derived().confirmation(current())}>
      {numbers => (
        <Confirmation
          kind={kind}
          source={pictures()}
          refs={refs()}
          options={options()}
          numbers={numbers()}
          onConfirm={() => props.onPrint(options())}
          onBack={() => setOver(undefined)}
        />
      )}
    </Show>
    </>
  )
}
