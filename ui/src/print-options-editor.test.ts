// Tests of the Print Options editor, a pure module: tables of cases against its interface, without mounting a screen.
import { expect, test } from "vitest"
import type { FileFacts } from "../../shared/api.ts"
import type { FormatLayout, Item, PrintOptions } from "../../shared/print-options.ts"
import { edit, startEditing, type Edit, type Editing, type LayoutPick, type ShowSheet } from "./print-options-editor.ts"
import type { PresetValues } from "./presets.ts"
import { items } from "./testing/options-screen.ts"

/** A PDF of that many A4 pages: refs count them from 1. */
const pdfOf = (pageCount: number): FileFacts[] =>
  [{ kind: "pdf", pageCount, pages: Array.from({ length: pageCount }, () => ({ width: 595, height: 842 })) }]

/** That many landscape photos of 4000 × 3000 pixels: refs count them from 0. */
const photosOf = (count: number): FileFacts[] =>
  Array.from({ length: count }, () => ({ kind: "photo", format: "jpeg", width: 4000, height: 3000, orientation: 1 }))

/** The Preset "Dokument Farbe": what a new PDF starts from. */
const document: PresetValues = {
  copies: 1, color: "color", paper: "A4", quality: "normal", printSize: { kind: "fill" }, position: "center",
  layout: { kind: "grid", perSheet: 1 },
}

/** Editing these facts, from the Print Options `document` with these changes; every page or photo once unless `items` says otherwise. */
const editing = (facts: FileFacts[], changes: Partial<PrintOptions> = {}): Editing => startEditing(facts, { ...document, ...changes })

/** Each of the edits in turn, from `start`. */
const after = (start: Editing, ...edits: Edit[]) => edits.reduce((editing, change) => edit(editing, change).editing, start)

test("a new file starts with every page or photo printed once, unturned", () => {
  expect(editing(pdfOf(3)).options.items).toEqual(items(1, 1, 1))
  expect(editing(photosOf(2)).options.items).toEqual(items(1, 1))
})

test.each<[string, FileFacts[], Item[], Edit, Item[], ShowSheet | undefined]>([
  ["page 2 of a PDF twice", pdfOf(3), items(1, 1, 1), { kind: "repeats", ref: 2, count: 2 }, items(1, 2, 1), undefined],
  ["photo 0 left out", photosOf(2), items(1, 1), { kind: "repeats", ref: 0, count: 0 }, items(0, 1), undefined],
  ["a page brought back shows its sheet", pdfOf(3), items(1, 0, 1), { kind: "repeats", ref: 2, count: 1 }, items(1, 1, 1), { ref: 2 }],
  ["a count stops at 50", photosOf(1), items(1), { kind: "repeats", ref: 0, count: 51 }, items(50), undefined],
  ["a count stops at 0", photosOf(1), items(1), { kind: "repeats", ref: 0, count: -1 }, items(0), undefined],
])("Repeats: %s", (_name, facts, before, change, expected, show) => {
  const edited = edit(editing(facts, { items: before }), change)
  expect(edited.editing.options.items).toEqual(expected)
  expect(edited.show).toEqual(show)
})

/** Page or photo items with these fields besides their count of 1. */
const item = (fields: Partial<Item> = {}): Item => ({ count: 1, turn: 0, ...fields })

test.each<[string, FileFacts[], Partial<PrintOptions>, Edit, Partial<PrintOptions>]>([
  ["Alle gleich: every page that prints, none switched on", pdfOf(3), { items: items(1, 0, 3) }, { kind: "all-same", count: 2 }, { items: items(2, 0, 2) }],
  ["a quarter turn to the right of page 2", pdfOf(2), {}, { kind: "turn", ref: 2, by: 90 }, { items: [item(), item({ turn: 90 })] }],
  ["a quarter turn to the left of photo 0, past 0", photosOf(1), {}, { kind: "turn", ref: 0, by: 270 }, { items: [item({ turn: 270 })] }],
  ["a turn round to 0", photosOf(1), { items: [item({ turn: 270 })] }, { kind: "turn", ref: 0, by: 90 }, { items: [item()] }],
  ["the size of page 1 at Füllen switches to Einpassen", pdfOf(2), {}, { kind: "switch-size", ref: 1 }, { items: [item({ size: "fit" }), item()] }],
  ["the size of page 1 at Einpassen switches to Füllen", pdfOf(2), { printSize: { kind: "fit" } }, { kind: "switch-size", ref: 1 }, { items: [item({ size: "fill" }), item()] }],
  ["the size of page 1 at a percentage switches to Füllen", pdfOf(2), { printSize: { kind: "percent", value: 80 } }, { kind: "switch-size", ref: 1 }, { items: [item({ size: "fill" }), item()] }],
  ["the size of its own of photo 1 switches back", photosOf(2), { items: [item(), item({ size: "fit" })] }, { kind: "switch-size", ref: 1 }, { items: [item(), item({ size: "fill" })] }],
  ["Größe für alle drops the sizes of their own", pdfOf(2), { items: [item({ size: "fit" }), item()] }, { kind: "size-for-all", printSize: { kind: "percent", value: 95 } }, { printSize: { kind: "percent", value: 95 }, items: [item(), item()] }],
  ["Position", pdfOf(1), {}, { kind: "position", position: "top-left" }, { position: "top-left" }],
  ["a Pan of page 1", pdfOf(2), {}, { kind: "pan", ref: 1, pan: { x: 0.2 } }, { items: [item({ pan: { x: 0.2 } }), item()] }],
  ["a Pan keeps the other axis", pdfOf(1), { items: [item({ pan: { x: 0.2, y: 0.7 } })] }, { kind: "pan", ref: 1, pan: { y: 0.1 } }, { items: [item({ pan: { x: 0.2, y: 0.1 } })] }],
  ["copies", pdfOf(1), {}, { kind: "details", changes: { copies: 3 } }, { copies: 3 }],
  ["colour, paper and quality", pdfOf(1), {}, { kind: "details", changes: { color: "mono", paper: "EnvC5", quality: "draft" } }, { color: "mono", paper: "EnvC5", quality: "draft" }],
  ["another grid", pdfOf(1), {}, { kind: "layout", layout: { kind: "grid", perSheet: 4 } }, { layout: { kind: "grid", perSheet: 4 } }],
])("%s", (_name, facts, before, change, changed) => {
  const start = editing(facts, before)
  const edited = edit(start, change)
  expect(edited.editing.options).toEqual({ ...start.options, ...changed })
})

// The Pan rule (see GLOSSARY.md): a Pan stays through a turn, another layout, another paper and other Repeats, and goes
// when the Print size or Position it overrides is chosen again, by hand or with a Preset.
test.each<[string, Edit, "kept" | "dropped"]>([
  ["a turn", { kind: "turn", ref: 0, by: 90 }, "kept"],
  ["another layout", { kind: "layout", layout: { kind: "grid", perSheet: 2 } }, "kept"],
  ["a Photo format", { kind: "layout", layout: { kind: "format", format: "10x15" } }, "kept"],
  ["a Lage", { kind: "format-switches", changes: { lage: "portrait" } }, "kept"],
  ["an own size", { kind: "own-size", side: "w", mm: 50 }, "kept"],
  ["another paper", { kind: "details", changes: { paper: "A5" } }, "kept"],
  ["copies", { kind: "details", changes: { copies: 2 } }, "kept"],
  ["other Repeats", { kind: "repeats", ref: 0, count: 3 }, "kept"],
  ["Alle gleich", { kind: "all-same", count: 2 }, "kept"],
  ["the size of the other photo", { kind: "switch-size", ref: 1 }, "kept"],
  ["its own size", { kind: "switch-size", ref: 0 }, "dropped"],
  ["Größe für alle", { kind: "size-for-all", printSize: { kind: "fill" } }, "dropped"],
  ["Position", { kind: "position", position: "center" }, "dropped"],
  ["a Preset", { kind: "preset", values: document }, "dropped"],
])("the Pan of photo 0 through %s", (_name, change, fate) => {
  const panned = edit(editing(photosOf(2)), { kind: "pan", ref: 0, pan: { x: 0.9 } }).editing
  const [first] = edit(panned, change).editing.options.items
  if (fate === "kept") expect(first!.pan).toEqual({ x: 0.9 })
  else expect(first).not.toHaveProperty("pan")
})

/** The Preset "Foto": what new photos start from. */
const photo: PresetValues = {
  copies: 1, color: "color", paper: "A4", quality: "normal", printSize: { kind: "fit" }, position: "center",
  layout: { kind: "grid", perSheet: 1 },
}

test("picking a Preset sets its seven fields; how often each page or photo prints, its turn and its size of its own stay", () => {
  const start = editing(photosOf(3), {
    copies: 2, color: "mono", paper: "A5", quality: "draft", printSize: { kind: "percent", value: 80 }, position: "top",
    layout: { kind: "grid", perSheet: 4 },
    items: [item({ count: 2, turn: 90 }), item({ count: 0 }), item({ size: "fill" })],
  })
  const etiketten: PresetValues = { ...photo, copies: 3, layout: { kind: "format", format: "pass", lage: "landscape", gap: false, cutLines: true } }

  const { editing: picked, show } = edit(start, { kind: "preset", values: etiketten })

  expect(picked.options).toEqual({ ...etiketten, items: [item({ count: 2, turn: 90 }), item({ count: 0 }), item({ size: "fill" })] })
  expect(show).toBeUndefined()
})

const format = (name: FormatLayout["format"], lage: FormatLayout["lage"] = "save", gap = true, cutLines = false): FormatLayout =>
  ({ kind: "format", format: name, lage, gap, cutLines })

// A Photo format prints at Füllen, its default, or Einpassen; Lage, gap and cut lines carry over from format to format.
test.each<[string, Partial<PrintOptions>, LayoutPick, Partial<PrintOptions>]>([
  ["from a grid a format starts at Füllen, Platz sparen, with the gap and without cut lines", { printSize: { kind: "fit" } }, { kind: "format", format: "10x15" }, { printSize: { kind: "fill" }, layout: format("10x15") }],
  ["from a percentage a format starts at Füllen", { printSize: { kind: "percent", value: 100 }, layout: format("10x15") }, { kind: "format", format: "pass" }, { printSize: { kind: "fill" }, layout: format("pass") }],
  ["from a format with Einpassen another format keeps it", { printSize: { kind: "fit" }, layout: format("10x15") }, { kind: "format", format: "9x13" }, { printSize: { kind: "fit" }, layout: format("9x13") }],
  ["another format keeps the Lage and the switches", { layout: format("10x15", "portrait", false, true) }, { kind: "format", format: "9x13" }, { layout: format("9x13", "portrait", false, true) }],
  ["Eigenes is the own size of 60 × 90 mm to begin with", { layout: format("10x15", "landscape") }, { kind: "format", format: "own" }, { layout: format({ w: 60, h: 90 }, "landscape") }],
  ["a grid keeps the Print size", { printSize: { kind: "percent", value: 100 }, layout: format("10x15") }, { kind: "grid", perSheet: 2 }, { layout: { kind: "grid", perSheet: 2 } }],
])("choosing a layout: %s", (_name, before, layout, changed) => {
  const start = editing(photosOf(2), { printSize: { kind: "fill" }, ...before })
  const { editing: chosen, show } = edit(start, { kind: "layout", layout })
  expect(chosen.options).toEqual({ ...start.options, ...changed })
  expect(show).toBe("first")
})

test.each<[string, Partial<PrintOptions>, Edit[], FormatLayout["format"] | undefined, { w: number; h: number }]>([
  ["the own size at Eigenes", { layout: format({ w: 60, h: 90 }) }, [{ kind: "own-size", side: "w", mm: 100 }], { w: 100, h: 90 }, { w: 100, h: 90 }],
  ["an empty field", { layout: format({ w: 60, h: 90 }) }, [{ kind: "own-size", side: "h", mm: Number.NaN }], { w: 60, h: Number.NaN }, { w: 60, h: Number.NaN }],
  ["the own size stays while another layout is chosen", { layout: format({ w: 60, h: 90 }) }, [
    { kind: "own-size", side: "w", mm: 100 },
    { kind: "layout", layout: { kind: "grid", perSheet: 4 } },
    { kind: "layout", layout: { kind: "format", format: "own" } },
  ], { w: 100, h: 90 }, { w: 100, h: 90 }],
  ["Print Options from before a login bring theirs", { layout: format({ w: 40, h: 45 }) }, [], { w: 40, h: 45 }, { w: 40, h: 45 }],
  ["a Preset brings its own", {}, [{ kind: "preset", values: { ...photo, layout: format({ w: 30, h: 50 }) } }, { kind: "layout", layout: { kind: "grid", perSheet: 1 } }], undefined, { w: 30, h: 50 }],
])("Eigenes: %s", (_name, before, edits, printed, remembered) => {
  const edited = after(editing(photosOf(1), before), ...edits)
  const { layout } = edited.options
  expect(layout.kind === "format" ? layout.format : undefined).toEqual(printed)
  expect(edited.ownSize).toEqual(remembered)
})

test.each<[string, Partial<FormatLayout>]>([
  ["Lage", { lage: "portrait" }],
  ["the gap", { gap: false }],
  ["the cut lines", { cutLines: true }],
])("at a Photo format, %s", (_name, changes) => {
  const start = editing(photosOf(2), { layout: format("10x15") })
  expect(edit(start, { kind: "format-switches", changes }).editing.options.layout).toEqual({ ...format("10x15"), ...changes })
})

// The server's facts replace the browser's once the upload is done.
test.each<[string, FileFacts[], FileFacts[], Item[], ShowSheet | undefined]>([
  ["the same pages: everything chosen stays", pdfOf(3), pdfOf(3), items(2, 0, 1), undefined],
  ["another page count: every page prints once, from the first sheet", pdfOf(3), pdfOf(4), items(1, 1, 1, 1), "first"],
  ["a photo fewer: every photo prints once", photosOf(3), photosOf(2), items(1, 1), "first"],
])("facts from the server: %s", (_name, browser, server, expected, show) => {
  const start = editing(browser, { items: items(2, 0, 1) })
  const edited = edit(start, { kind: "facts", facts: server })
  expect(edited.editing.options.items).toEqual(expected)
  expect(edited.editing.source).toEqual(editing(server).source)
  expect(edited.show).toEqual(show)
})
