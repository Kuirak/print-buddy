// The Print Options editor: every edit of the Print Options on the options screen, and everything derived from them.
// Plain TypeScript without Solid: the options screen keeps the result in a signal and adds the view state and the German.
import type { FileFacts } from "../../shared/api.ts"
import type { LayoutInput } from "../../shared/layout.ts"
import {
  maxCount,
  type FormatLayout,
  type Item,
  type PerSheet,
  type Position,
  type PrintOptions,
  type PrintSizeMode,
  type Rotation,
} from "../../shared/print-options.ts"
import type { PresetValues } from "./presets.ts"

/** What the Print Options are laid out for: the PDF's pages or the photos, from their facts, as the layout module takes them. */
export type Source = LayoutInput["source"]

/** An own size in mm, as the inputs give it: a side may be `NaN` while its field is empty. */
export type OwnSize = { w: number; h: number }

/** The Print Options being edited, with what editing them keeps besides. */
export type Editing = {
  source: Source
  options: PrintOptions
  /** What "Eigenes" stands for: the own size of this Print Job, remembered while another layout is chosen. */
  ownSize: OwnSize
}

/** How the photos lie at a Photo format, and what helps cutting them apart: they carry over from format to format. */
export type FormatSwitches = Pick<FormatLayout, "lage" | "gap" | "cutLines">

/** A layout as the strip offers it: a grid, or a Photo format by its name, or Eigenes. The editor adds the rest. */
export type LayoutPick = { kind: "grid"; perSheet: PerSheet } | { kind: "format"; format: Extract<FormatLayout["format"], string> | "own" }

/**
 * A change the person makes. A page or photo is named by its `ref`, as the preview and the thumbnails name it: a PDF's
 * pages count from 1, photos from 0.
 */
export type Edit =
  /** Repeats of one page or photo: 0 leaves it out, up to `maxCount`. */
  | { kind: "repeats"; ref: number; count: number }
  /** "Alle gleich": every page or photo that prints, prints `count` times. None is switched on or off. */
  | { kind: "all-same"; count: number }
  /** A quarter turn of one page or photo, clockwise (90) or back (270), on top of the turn it gets by itself. */
  | { kind: "turn"; ref: number; by: 90 | 270 }
  /** The size of one page or photo of its own: Füllen becomes Einpassen, anything else becomes Füllen. */
  | { kind: "switch-size"; ref: number }
  /** "Größe für alle": the Print size for every page or photo; the sizes they had of their own go. */
  | { kind: "size-for-all"; printSize: PrintSizeMode }
  | { kind: "position"; position: Position }
  /** Moves one page or photo where it overlaps the border: the axes of its `pan` that changed (see `Item.pan`). */
  | { kind: "pan"; ref: number; pan: { x?: number; y?: number } }
  /**
   * Another layout; the preview goes back to the first sheet. A Photo format keeps the Lage and the switches of the
   * format before, and prints at Füllen when it comes from a grid or a percentage. Eigenes is the remembered own size.
   */
  | { kind: "layout"; layout: LayoutPick }
  /** Lage, gap or cut lines, at a Photo format. */
  | { kind: "format-switches"; changes: Partial<FormatSwitches> }
  /** One side of the own size, which Eigenes prints at while it is chosen. */
  | { kind: "own-size"; side: "w" | "h"; mm: number }
  /** The detailed controls behind "Einstellungen". */
  | { kind: "details"; changes: Partial<Pick<PrintOptions, "copies" | "color" | "paper" | "quality">> }
  /** Picking a Preset: its seven fields. How often each page or photo prints, its turn and its size of its own stay. */
  | { kind: "preset"; values: PresetValues }
  /**
   * The server's facts, in place of the browser's. If they count the pages or photos differently, every page or photo
   * prints once, and the preview shows the first sheet.
   */
  | { kind: "facts"; facts: readonly FileFacts[] }

/** Which sheet the preview goes to after an edit: the first one, or the first one with this page or photo. */
export type ShowSheet = "first" | { ref: number }

/** The Print Options after an edit, and which sheet to show; without `show` the preview stays where it is. */
export type Edited = { editing: Editing; show?: ShowSheet }

/** What Eigenes stands for until the person types an own size. */
const defaultOwnSize: OwnSize = { w: 60, h: 90 }

/** Where a Photo format starts when it comes from a grid. */
const defaultSwitches: FormatSwitches = { lage: "save", gap: true, cutLines: false }

function sourceOf(facts: readonly FileFacts[]): Source {
  const first = facts[0]
  return first?.kind === "pdf" ? first : { kind: "photos", photos: facts.filter(fact => fact.kind === "photo") }
}

/** Each page or photo once, printed once, unturned. */
function everyOnce(source: Source): Item[] {
  return (source.kind === "pdf" ? source.pages : source.photos).map(() => ({ count: 1, turn: 0 }))
}

/** The own size of a layout at Eigenes. */
function ownSizeOf(layout: PrintOptions["layout"]): OwnSize | undefined {
  return layout.kind === "format" && typeof layout.format !== "string" ? { ...layout.format } : undefined
}

/**
 * Starts editing the Print Options for files with these facts: from a Preset's values, with every page or photo printed
 * once, or from whole Print Options, such as those from before a login ran out.
 */
export function startEditing(facts: readonly FileFacts[], from: PresetValues & { items?: Item[] }): Editing {
  const source = sourceOf(facts)
  const options = structuredClone(from)
  return { source, options: { ...options, items: options.items ?? everyOnce(source) }, ownSize: ownSizeOf(options.layout) ?? defaultOwnSize }
}

/** The Lage and the switches a Photo format chosen now starts with: those of the format chosen, or where a format starts. */
export function formatSwitches(options: PrintOptions): FormatSwitches {
  if (options.layout.kind === "grid") return defaultSwitches
  const { lage, gap, cutLines } = options.layout
  return { lage, gap, cutLines }
}

/** Applies one edit. `editing` stays as it is: the result is new. */
export function edit(editing: Editing, change: Edit): Edited {
  const options = structuredClone(editing.options)
  let { source, ownSize } = editing
  let show: ShowSheet | undefined
  const itemOf = (ref: number) => options.items[editing.source.kind === "pdf" ? ref - 1 : ref]!
  switch (change.kind) {
    case "repeats": {
      const item = itemOf(change.ref)
      const count = Math.max(0, Math.min(maxCount, change.count))
      if (item.count === 0 && count > 0) show = { ref: change.ref }
      item.count = count
      break
    }
    case "all-same":
      for (const item of options.items) if (item.count > 0) item.count = change.count
      break
    case "turn": {
      const item = itemOf(change.ref)
      item.turn = ((item.turn + change.by) % 360) as Rotation
      break
    }
    case "switch-size": {
      const item = itemOf(change.ref)
      item.size = sizeOf(options, item) === "fill" ? "fit" : "fill"
      break
    }
    case "size-for-all":
      options.printSize = change.printSize
      for (const item of options.items) delete item.size
      break
    case "position":
      options.position = change.position
      break
    case "pan": {
      const item = itemOf(change.ref)
      item.pan = { ...item.pan, ...change.pan }
      break
    }
    case "layout": {
      const chosen = change.layout
      if (chosen.kind === "grid") options.layout = chosen
      else {
        if (options.layout.kind === "grid" || options.printSize.kind === "percent") options.printSize = { kind: "fill" }
        options.layout = { kind: "format", format: chosen.format === "own" ? { ...ownSize } : chosen.format, ...formatSwitches(options) }
      }
      show = "first"
      break
    }
    case "format-switches":
      if (options.layout.kind === "format") Object.assign(options.layout, change.changes)
      break
    case "own-size":
      ownSize = { ...ownSize, [change.side]: change.mm }
      if (options.layout.kind === "format" && typeof options.layout.format !== "string") options.layout.format = { ...ownSize }
      break
    case "details":
      Object.assign(options, change.changes)
      break
    case "preset":
      Object.assign(options, structuredClone(change.values))
      ownSize = ownSizeOf(options.layout) ?? ownSize
      break
    case "facts": {
      source = sourceOf(change.facts)
      const once = everyOnce(source)
      if (options.items.length !== once.length) {
        options.items = once
        show = "first"
      }
      break
    }
  }
  const dropped = dropsPans(change)
  if (dropped === "all") for (const item of options.items) delete item.pan
  else if (dropped !== undefined) delete itemOf(dropped).pan
  return { editing: { source, options, ownSize }, ...(show && { show }) }
}

/**
 * The Pan rule (see GLOSSARY.md), and the one place it is written: which Pans an edit drops. A Pan goes when the Print
 * size or Position it overrides is chosen again, by hand or with a Preset: for every page or photo, or for the one with
 * this ref. Every other edit keeps it: a turn, another layout, another paper, other Repeats.
 */
function dropsPans(change: Edit): "all" | number | undefined {
  switch (change.kind) {
    case "size-for-all":
    case "position":
    case "preset":
      return "all"
    case "switch-size":
      return change.ref
  }
  return undefined
}

/** What a page or photo prints at: its own size, or the size for all; none of them at a percentage. */
function sizeOf(options: PrintOptions, item: Item): "fill" | "fit" | undefined {
  return item.size ?? (options.printSize.kind === "percent" ? undefined : options.printSize.kind)
}
