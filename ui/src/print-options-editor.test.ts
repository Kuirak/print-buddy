// Tests of the Print Options editor, a pure module: tables of cases against its interface, without mounting a screen.
import { expect, test } from "vitest"
import type { FileFacts } from "../../shared/api.ts"
import type { Unprintable } from "../../shared/layout.ts"
import type { FormatLayout, Item, PrintOptions } from "../../shared/print-options.ts"
import { derive, edit, startEditing, type Edit, type Editing, type LayoutPick, type ShowSheet, type SizeChoice } from "./print-options-editor.ts"
import type { PresetValues } from "./presets.ts"
import { items } from "./testing/options-screen.ts"
import { printerInfo } from "./testing/printer-info.ts"

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

/** The Printer's margins on every paper: 9 pt left and right, 12 pt top and bottom. A4 then prints on 577.28 × 817.89 pt. */
const { margins } = printerInfo()

/** A PDF of that many pages of US Letter: a little wider and a little shorter than A4 (595.28 × 841.89 pt). */
const letterOf = (pageCount: number): FileFacts[] =>
  [{ kind: "pdf", pageCount, pages: Array.from({ length: pageCount }, () => ({ width: 612, height: 792 })) }]

// The percentage the Print size row and the confirmation show, on the sheet in the preview.
test.each<[string, Partial<PrintOptions>, number, number | undefined]>([
  ["a percentage is the one given", { printSize: { kind: "percent", value: 95 } }, 0, 95],
  // Füllen covers the whole sheet: 841.89 / 792 = 1.063
  ["Füllen is read off the page", {}, 0, 106],
  // Einpassen lies inside the printable area: 577.28 / 612 = 0.943
  ["Einpassen is read off the page", { printSize: { kind: "fit" } }, 0, 94],
  // two to a sheet, each in a Cell of 408.95 × 577.28 pt: Füllen 577.28 / 792 = 0.729, Einpassen 408.95 / 612 = 0.668
  ["read off the first page without a size of its own", { items: [item({ size: "fit" }), item()], layout: { kind: "grid", perSheet: 2 } }, 0, 73],
  ["read off the first page when all have one", { items: [item({ size: "fit" }), item({ size: "fill" })], layout: { kind: "grid", perSheet: 2 } }, 0, 67],
  ["read off the sheet in the preview", { items: [item(), item({ size: "fit" })] }, 1, 94],
  ["none with nothing on the sheet", { items: items(0, 0) }, 0, undefined],
])("percent: %s", (_name, before, sheet, expected) => {
  expect(derive(editing(letterOf(2), before), margins).percent(sheet)).toBe(expected)
})

// While the pages or photos that print have sizes that differ, every size in use, and none is the size for all.
test.each<[string, Partial<PrintOptions>, SizeChoice[] | undefined]>([
  ["all at the size for all", {}, undefined],
  ["all the same of their own", { items: [item({ size: "fit" }), item({ size: "fit" })] }, undefined],
  ["one at Einpassen of its own", { items: [item({ size: "fit" }), item()] }, ["fit", "fill"]],
  ["one left out doesn't count", { items: [item({ size: "fit", count: 0 }), item()] }, undefined],
  ["100 % for all", { printSize: { kind: "percent", value: 100 }, items: [item(), item({ size: "fill" })] }, ["100", "fill"]],
  ["another percentage is no shortcut", { printSize: { kind: "percent", value: 95 }, items: [item(), item({ size: "fill" })] }, ["fill"]],
])("mixed sizes: %s", (_name, before, expected) => {
  expect(derive(editing(photosOf(2), before), margins).mixedSizes).toEqual(expected)
})

test("until the Printer's margins are there, nothing is laid out", () => {
  const derived = derive(editing(photosOf(2)), undefined)
  expect(derived.laidOut).toBeUndefined()
  expect(derived.sheets).toBeUndefined()
})

/** 15 mm in points. */
const mm15 = (15 * 72) / 25.4

// Whatever the reason, the preview still draws what it can: the sheets of one copy, sized as chosen.
test.each<[string, FileFacts[], Partial<PrintOptions>, Unprintable["reason"] | undefined, number[] | undefined]>([
  ["Print Options that print", photosOf(3), {}, undefined, [1, 1, 1]],
  ["an own size of 15 mm: the slots that small", photosOf(2), { layout: format({ w: 15, h: 90 }) }, "own-size-too-small", [2]],
  ["an empty own size: no slots", photosOf(2), { layout: format({ w: Number.NaN, h: 90 }) }, "own-size-too-small", []],
  ["13×18 on an envelope DL", photosOf(2), { paper: "EnvDL", layout: format("13x18") }, "no-cells", []],
  ["nothing printed", photosOf(2), { items: items(0, 0) }, "nothing-printed", []],
  ["over 100 sheets", photosOf(3), { items: items(50, 50, 1) }, "over-sheet-limit", Array<number>(101).fill(1)],
])("the preview: %s", (_name, facts, before, reason, placements) => {
  const derived = derive(editing(facts, before), margins)
  expect(derived.laidOut?.reason).toBe(reason)
  expect(derived.sheets?.map(sheet => sheet.placements.length)).toEqual(placements)
})

test("an own size under 20 mm is drawn at the size typed", () => {
  const [slot] = derive(editing(photosOf(1), { layout: format({ w: 15, h: 90 }, "portrait") }), margins).sheets![0]!.placements
  expect(slot!.clip.width).toBeCloseTo(mm15)
})

test("an own size under 20 mm is over the sheet limit too when its sheets are", () => {
  // 100 photos in slots 15 mm wide take more than one sheet a copy: over 100 sheets in 100 copies
  const derived = derive(editing(photosOf(2), { copies: 100, items: items(50, 50), layout: format({ w: 15, h: 90 }) }), margins)
  expect(derived.laidOut?.reason).toBe("own-size-too-small")
  expect(derived.overLimit).toBe(true)
})

test("while the server's facts count differently for a moment, nothing is laid out", () => {
  const start = editing(photosOf(2))
  const derived = derive({ ...start, options: { ...start.options, items: items(1) } }, margins)
  expect(derived.laidOut?.reason).toBe("items-mismatch")
  expect(derived.sheets).toBeUndefined()
})

test.each<[string, FileFacts[], Item[], number[], number[]]>([
  ["a PDF's pages count from 1", pdfOf(3), items(1, 0, 2), [1, 2, 3], [1, 3]],
  ["photos count from 0", photosOf(3), items(0, 1, 1), [0, 1, 2], [1, 2]],
])("refs and which print: %s", (_name, facts, counts, refs, printed) => {
  const derived = derive(editing(facts, { items: counts }), margins)
  expect(derived.refs).toEqual(refs)
  expect(derived.printed).toEqual(printed)
})

test("a page or photo by its ref: what was chosen for it, and the size it prints at", () => {
  const derived = derive(editing(pdfOf(2), { items: [item(), item({ turn: 90, size: "fit" })] }), margins)
  expect(derived.itemOf(2)).toEqual(item({ turn: 90, size: "fit" }))
  expect(derived.sizeOf(1)).toBe("fill")
  expect(derived.sizeOf(2)).toBe("fit")
  expect(derive(editing(pdfOf(1), { printSize: { kind: "percent", value: 95 } }), margins).sizeOf(1)).toBeUndefined()
})

test.each<[string, FileFacts[], Partial<PrintOptions>, boolean]>([
  ["a page at Einpassen", letterOf(2), { printSize: { kind: "fit" } }, false],
  ["only the second sheet cut off at 100 %", [{ kind: "pdf", pageCount: 2, pages: [{ width: 300, height: 300 }, { width: 900, height: 300 }] }], { printSize: { kind: "percent", value: 100 } }, true],
  ["photos cropped to a Photo format", photosOf(2), { layout: format("10x15") }, false],
])("cut off: %s", (_name, facts, before, cutOff) => {
  expect(derive(editing(facts, before), margins).cutOff).toBe(cutOff)
})

test("the confirmation's numbers: sheets of one copy and of all, the sketch of the layout, the percentage, mixed sizes, cut-off and the limit", () => {
  // 3 pages, 2 to a sheet, twice: 2 sheets a copy
  const derived = derive(editing(pdfOf(3), { copies: 2, printSize: { kind: "fit" }, layout: { kind: "grid", perSheet: 2 } }), margins)
  const numbers = derived.confirmation(0)!
  // Einpassen in a Cell of 408.95 × 577.28 pt: 577.28 / 842 = 0.686
  expect(numbers).toMatchObject({ sheetsPerCopy: 2, sheets: 4, overLimit: false, maxSheets: 100, percent: 69, mixedSizes: false, cutOff: false })
  expect(numbers.cells).toHaveLength(2)

  const over = derive(editing(photosOf(2), { copies: 5, items: items(25, 0) }), margins)
  expect(over.overLimit).toBe(true)
  expect(over.confirmation(0)).toMatchObject({ sheetsPerCopy: 25, sheets: 125, overLimit: true })
  expect(derive(editing(photosOf(2)), undefined).confirmation(0)).toBeUndefined()
})

test("a landscape first page reads the grids the other way", () => {
  const landscapePdf: FileFacts[] = [{ kind: "pdf", pageCount: 1, pages: [{ width: 842, height: 595 }] }]
  expect(derive(editing(landscapePdf), margins).landscape).toBe(true)
  expect(derive(editing(pdfOf(1)), margins).landscape).toBe(false)
})

test.each<[string, Partial<PrintOptions>, Pick<FormatLayout, "lage" | "gap" | "cutLines">]>([
  ["at a grid: Platz sparen, with the gap, without cut lines", {}, { lage: "save", gap: true, cutLines: false }],
  ["at a format: its own", { layout: format("pass", "landscape", false, true) }, { lage: "landscape", gap: false, cutLines: true }],
])("the Photo formats on offer start %s", (_name, before, switches) => {
  expect(derive(editing(photosOf(2), before), margins).formatSwitches).toEqual(switches)
})
