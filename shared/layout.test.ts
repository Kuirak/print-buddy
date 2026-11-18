import assert from "node:assert/strict"
import { test } from "node:test"
import { layout, type LayoutInput, type Sheet } from "./layout.ts"
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
