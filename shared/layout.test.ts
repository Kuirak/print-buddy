import assert from "node:assert/strict"
import { test } from "node:test"
import { layout, SHEET_SIZES, type LayoutInput, type Sheet } from "./layout.ts"
import type { PrintOptions } from "./print-options.ts"

// A made-up sheet with round numbers: 600 × 800 pt, and a different margin on every side.
const sheet = { width: 600, height: 800 }
const margins = { top: 20, right: 30, bottom: 40, left: 10 }
// So the printable area is 560 × 740 pt, from 10 pt from the left and 20 pt from the top.

const options = (changes: Partial<PrintOptions> = {}): PrintOptions => ({
  copies: 1,
  color: "color",
  paper: "A4",
  quality: "normal",
  printSize: { kind: "percent", value: 100 },
  position: "center",
  pagesPerSheet: 1,
  rotation: 0,
  selection: [1],
  ...changes,
})

const pdf = (...pages: [number, number][]): LayoutInput["source"] => ({
  kind: "pdf",
  pages: pages.map(([width, height]) => ({ width, height })),
})

/** Every number rounded to 1/100 pt, so the expected values can be written out. */
function rounded<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === "number" ? Math.round(v * 100) / 100 + 0 : v)))
}

const only = (sheets: Sheet[]) => {
  assert.equal(sheets.length, 1)
  assert.equal(sheets[0]!.placements.length, 1)
  return rounded(sheets[0]!.placements[0]!)
}

test("a PDF page at 100 % keeps its size in points and sits in the middle of the printable area", () => {
  const placement = only(layout({ source: pdf([300, 400]), options: options(), sheet, margins }))

  assert.deepEqual(placement, {
    ref: 1,
    rotation: 0,
    scale: 1,
    left: 140,
    top: 190,
    width: 300,
    height: 400,
    matrix: [1, 0, 0, 1, 140, 210],
    clip: { left: 0, top: 0, width: 600, height: 800 },
  })
})

const box = (sheets: Sheet[]) => {
  const { scale, left, top, width, height } = only(sheets)
  return { scale, left, top, width, height }
}

const fit = { kind: "fit" } as const
const fill = { kind: "fill" } as const
const percent = (value: number) => ({ kind: "percent", value }) as const

test("Print size: Einpassen fits inside the printable area, Füllen covers the sheet, a percentage scales from the natural size", async t => {
  const cases: [string, [number, number], PrintOptions["printSize"], ReturnType<typeof box>][] = [
    // Einpassen: the printable area is 560 × 740.
    ["Einpassen, same shape as the printable area", [280, 370], fit, { scale: 2, left: 10, top: 20, width: 560, height: 740 }],
    ["Einpassen, wide page: the width decides", [400, 200], fit, { scale: 1.4, left: 10, top: 250, width: 560, height: 280 }],
    ["Einpassen, tall page: the height decides", [200, 500], fit, { scale: 1.48, left: 142, top: 20, width: 296, height: 740 }],
    ["Einpassen, page larger than the sheet shrinks", [1120, 1000], fit, { scale: 0.5, left: 10, top: 140, width: 560, height: 500 }],
    // Füllen: the sheet is 600 × 800.
    ["Füllen, same shape as the sheet", [300, 400], fill, { scale: 2, left: -10, top: -10, width: 600, height: 800 }],
    ["Füllen, wide page: the height decides", [400, 200], fill, { scale: 4, left: -510, top: -10, width: 1600, height: 800 }],
    ["Füllen, tall page: the width decides", [200, 500], fill, { scale: 3, left: -10, top: -360, width: 600, height: 1500 }],
    ["100 %", [300, 400], percent(100), { scale: 1, left: 140, top: 190, width: 300, height: 400 }],
    ["50 %", [300, 400], percent(50), { scale: 0.5, left: 215, top: 290, width: 150, height: 200 }],
    ["105 %, one step up", [300, 400], percent(105), { scale: 1.05, left: 132.5, top: 180, width: 315, height: 420 }],
    ["250 %, larger than the sheet", [300, 400], percent(250), { scale: 2.5, left: -85, top: -110, width: 750, height: 1000 }],
  ]
  for (const [name, page, printSize, expected] of cases) {
    await t.test(name, () => {
      assert.deepEqual(box(layout({ source: pdf(page), options: options({ printSize }), sheet, margins })), expected)
    })
  }
})

test("Position aligns the content to the printable area", async t => {
  // The printable area reaches from 10 to 570 pt across and from 20 to 760 pt down.
  // Small: a 300 × 400 page at 100 %, so Position decides where the empty space ends up.
  // Large: the same page at 250 % (750 × 1000), so Position decides which part is cut off.
  const cases: [PrintOptions["position"], small: [left: number, top: number], large: [left: number, top: number]][] = [
    ["top-left", [10, 20], [10, 20]],
    ["top", [140, 20], [-85, 20]],
    ["top-right", [270, 20], [-180, 20]],
    ["left", [10, 190], [10, -110]],
    ["center", [140, 190], [-85, -110]],
    ["right", [270, 190], [-180, -110]],
    ["bottom-left", [10, 360], [10, -240]],
    ["bottom", [140, 360], [-85, -240]],
    ["bottom-right", [270, 360], [-180, -240]],
  ]
  for (const [position, small, large] of cases) {
    await t.test(position, () => {
      const at = (value: number) => {
        const { left, top } = box(layout({ source: pdf([300, 400]), options: options({ position, printSize: percent(value) }), sheet, margins }))
        return [left, top]
      }
      assert.deepEqual(at(100), small)
      assert.deepEqual(at(250), large)
    })
  }
})

test("a sheet says whether content is cut off and whether part of it stays empty", async t => {
  const none = { top: 0, right: 0, bottom: 0, left: 0 }
  const cases: [string, [number, number], PrintOptions["printSize"], typeof margins, { cutOff: boolean; emptySpace: boolean }][] = [
    ["Einpassen, same shape as the printable area", [280, 370], fit, margins, { cutOff: false, emptySpace: false }],
    ["Einpassen, another shape", [400, 200], fit, margins, { cutOff: false, emptySpace: true }],
    ["Einpassen, a size that doesn't divide evenly", [333, 777], fit, margins, { cutOff: false, emptySpace: true }],
    ["Füllen: the unprintable edge cuts content off", [300, 400], fill, margins, { cutOff: true, emptySpace: false }],
    ["Füllen, another shape", [400, 200], fill, margins, { cutOff: true, emptySpace: false }],
    ["Füllen on a sheet without margins, same shape", [300, 400], fill, none, { cutOff: false, emptySpace: false }],
    ["100 %, smaller than the printable area", [300, 400], percent(100), margins, { cutOff: false, emptySpace: true }],
    ["100 %, exactly the printable area", [560, 740], percent(100), margins, { cutOff: false, emptySpace: false }],
    ["100 %, as large as the sheet", [600, 800], percent(100), margins, { cutOff: true, emptySpace: false }],
    ["250 %, larger than the sheet", [300, 400], percent(250), margins, { cutOff: true, emptySpace: false }],
    ["200 %, too wide and not tall enough", [400, 200], percent(200), margins, { cutOff: true, emptySpace: true }],
  ]
  for (const [name, page, printSize, edge, expected] of cases) {
    await t.test(name, () => {
      const [{ cutOff, emptySpace }] = layout({ source: pdf(page), options: options({ printSize }), sheet, margins: edge }) as [Sheet]
      assert.deepEqual({ cutOff, emptySpace }, expected)
    })
  }
})

test("the four papers have their sizes in points, portrait", () => {
  assert.deepEqual(rounded(SHEET_SIZES), {
    A4: { width: 595.28, height: 841.89 }, // 210 × 297 mm
    A5: { width: 419.53, height: 595.28 }, // 148 × 210 mm
    EnvDL: { width: 311.81, height: 623.62 }, // 110 × 220 mm
    EnvC5: { width: 459.21, height: 649.13 }, // 162 × 229 mm
  })
})

test("Print size on each paper: an A4 page of 595 × 842 pt with the Printer's A4 margins", async t => {
  const edge = { top: 12, right: 9, bottom: 12, left: 9 }
  const cases: [PrintOptions["paper"], PrintOptions["printSize"], ReturnType<typeof box>][] = [
    ["A4", fit, { scale: 0.97, left: 9, top: 12.49, width: 577.28, height: 816.92 }],
    ["A4", fill, { scale: 1, left: 0, top: -0.25, width: 595.28, height: 842.39 }],
    ["A4", percent(100), { scale: 1, left: 0.14, top: -0.06, width: 595, height: 842 }],
    ["A4", percent(50), { scale: 0.5, left: 148.89, top: 210.44, width: 297.5, height: 421 }],
    ["A5", fit, { scale: 0.67, left: 9, top: 13.53, width: 401.53, height: 568.21 }],
    ["A5", fill, { scale: 0.71, left: -0.56, top: 0, width: 420.65, height: 595.28 }],
    ["A5", percent(100), { scale: 1, left: -87.74, top: -123.36, width: 595, height: 842 }],
    ["A5", percent(50), { scale: 0.5, left: 61.01, top: 87.14, width: 297.5, height: 421 }],
    ["EnvDL", fit, { scale: 0.49, left: 9, top: 103.92, width: 293.81, height: 415.78 }],
    ["EnvDL", fill, { scale: 0.74, left: -64.44, top: 0, width: 440.68, height: 623.62 }],
    ["EnvDL", percent(100), { scale: 1, left: -141.59, top: -109.19, width: 595, height: 842 }],
    ["EnvDL", percent(50), { scale: 0.5, left: 7.16, top: 101.31, width: 297.5, height: 421 }],
    ["EnvC5", fit, { scale: 0.74, left: 9, top: 12.38, width: 441.21, height: 624.37 }],
    ["EnvC5", fill, { scale: 0.77, left: 0, top: -0.35, width: 459.21, height: 649.84 }],
    ["EnvC5", percent(100), { scale: 1, left: -67.89, top: -96.43, width: 595, height: 842 }],
    ["EnvC5", percent(50), { scale: 0.5, left: 80.86, top: 114.07, width: 297.5, height: 421 }],
  ]
  for (const [paper, printSize, expected] of cases) {
    await t.test(`${paper}, ${printSize.kind === "percent" ? `${printSize.value} %` : printSize.kind}`, () => {
      const sheets = layout({ source: pdf([595, 842]), options: options({ paper, printSize }), sheet: SHEET_SIZES[paper], margins: edge })
      assert.deepEqual(box(sheets), expected)
    })
  }
})
