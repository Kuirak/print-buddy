// Presets: named sets of Print Options, picked in one tap (see GLOSSARY.md). The built-in ones are
// defined here; own Presets and the starred defaults are kept in this phone's browser storage.
import { createSignal } from "solid-js"
import type { FileFacts } from "../../shared/api.ts"
import { parsePrintOptions, type PrintOptions } from "../../shared/print-options.ts"

/** The two file types a Print Job can hold. Each has its own Presets and its own default. */
export type FileKind = FileFacts["kind"]

/**
 * The file type of a Print Job, from what the server found out about its files. The only place that
 * decides it. The first file speaks for all: intake refuses a draft that mixes a PDF with photos.
 */
export function fileKind(facts: readonly FileFacts[]): FileKind {
  return facts[0]?.kind ?? "pdf"
}

/** The part of the Print Options a Preset stores. Page selection and rotation belong to the file. */
export type PresetValues = Pick<PrintOptions, "copies" | "color" | "paper" | "quality" | "printSize" | "position" | "pagesPerSheet">

export type Preset = {
  id: string
  name: string
  /** A Preset is offered only for files of this type. */
  kind: FileKind
  values: PresetValues
}

const fitCentre = { copies: 1, printSize: { kind: "fit" }, position: "center", pagesPerSheet: 1 } as const

/** The first one of each file type is its default until the person stars another. */
const builtIns: readonly Preset[] = [
  { id: "document-mono", name: "Dokument s/w", kind: "pdf", values: { ...fitCentre, color: "mono", paper: "A4", quality: "normal" } },
  { id: "document-color", name: "Dokument Farbe", kind: "pdf", values: { ...fitCentre, color: "color", paper: "A4", quality: "normal" } },
  { id: "envelope-dl", name: "Umschlag DL", kind: "pdf", values: { ...fitCentre, color: "mono", paper: "EnvDL", quality: "normal" } },
  { id: "photo", name: "Foto", kind: "photo", values: { ...fitCentre, color: "color", paper: "A4", quality: "normal" } },
  { id: "photo-mono-draft", name: "Foto s/w Toner sparen", kind: "photo", values: { ...fitCentre, color: "mono", paper: "A4", quality: "draft" } },
]

export const isBuiltIn = (preset: Preset) => builtIns.includes(preset)

function sameValues(a: PresetValues, b: PresetValues) {
  return a.copies === b.copies && a.color === b.color && a.paper === b.paper && a.quality === b.quality
    && a.printSize.kind === b.printSize.kind
    && (a.printSize.kind !== "percent" || b.printSize.kind !== "percent" || a.printSize.value === b.printSize.value)
    && a.position === b.position && a.pagesPerSheet === b.pagesPerSheet
}

/** What browser storage holds. `defaults` are the ids of the starred Presets. */
type Saved = { own: Preset[]; defaults: Partial<Record<FileKind, string>> }

const storageKey = "print-buddy.presets"

/** Reads browser storage. Anything that is not a Preset as this version writes it is left out. */
function load(): Saved {
  const saved: Saved = { own: [], defaults: {} }
  let raw: unknown
  try {
    raw = JSON.parse(localStorage.getItem(storageKey) ?? "null")
  } catch {
    return saved
  }
  if (typeof raw !== "object" || raw === null) return saved
  const { own, defaults } = raw as { own?: unknown; defaults?: unknown }
  for (const entry of Array.isArray(own) ? own as Partial<Preset>[] : []) {
    if (typeof entry?.id !== "string" || typeof entry.name !== "string") continue
    if (entry.kind !== "pdf" && entry.kind !== "photo") continue
    const options = parsePrintOptions({ ...entry.values, rotation: 0, selection: [] })
    if (!options) continue
    const { rotation, selection, ...values } = options
    saved.own.push({ id: entry.id, name: entry.name, kind: entry.kind, values })
  }
  if (typeof defaults === "object" && defaults !== null) {
    const { pdf, photo } = defaults as Record<string, unknown>
    if (typeof pdf === "string") saved.defaults.pdf = pdf
    if (typeof photo === "string") saved.defaults.photo = photo
  }
  return saved
}

/** The Presets for one file type on this phone: the built-in ones, then the person's own. */
export interface Presets {
  /** The Presets on offer for this file type, in the order of the chips. */
  list(): Preset[]
  /** The starred Preset: what a new file of this type starts from. */
  starred(): Preset
  /**
   * The Preset the Print Options match in every stored field, or `undefined` for "Eigene".
   * When several match, the one picked last wins.
   */
  matching(options: PresetValues): Preset | undefined
  /** Remembers which Preset the person tapped. */
  pick(preset: Preset): void
  /** Saves the stored part of the Print Options under a name as an own Preset and returns it. */
  save(name: string, options: PresetValues): Preset
  /** Deletes an own Preset and returns the Preset that is starred afterwards. */
  remove(preset: Preset): Preset
  /** Makes the Preset the default for this file type. */
  star(preset: Preset): void
}

/** Reads the Presets from browser storage. Every change is written back at once. */
export function createPresets(kind: FileKind): Presets {
  const [saved, setSaved] = createSignal(load())
  const [pickedId, setPickedId] = createSignal<string>()

  function store(next: Saved) {
    localStorage.setItem(storageKey, JSON.stringify(next))
    setSaved(next)
  }

  const all = (from: Saved) => [...builtIns, ...from.own].filter(preset => preset.kind === kind)
  // a starred Preset that no longer exists falls back to the built-in default
  const starred = (from: Saved) => all(from).find(preset => preset.id === from.defaults[kind]) ?? all(from)[0]!

  return {
    list: () => all(saved()),
    starred: () => starred(saved()),
    matching(options) {
      const matches = all(saved()).filter(preset => sameValues(preset.values, options))
      return matches.find(preset => preset.id === pickedId()) ?? matches[0]
    },
    pick(preset) {
      setPickedId(preset.id)
    },
    save(name, options) {
      // field by field: `options` may be the whole Print Options, and selection and rotation stay out
      const values: PresetValues = {
        copies: options.copies,
        color: options.color,
        paper: options.paper,
        quality: options.quality,
        printSize: { ...options.printSize },
        position: options.position,
        pagesPerSheet: options.pagesPerSheet,
      }
      const preset: Preset = { id: crypto.randomUUID(), name, kind, values }
      store({ ...saved(), own: [...saved().own, preset] })
      setPickedId(preset.id)
      return preset
    },
    remove(preset) {
      const next = { ...saved(), own: saved().own.filter(own => own.id !== preset.id) }
      store(next)
      return starred(next)
    },
    star(preset) {
      store({ ...saved(), defaults: { ...saved().defaults, [kind]: preset.id } })
    },
  }
}
