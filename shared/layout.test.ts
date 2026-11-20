import assert from "node:assert/strict"
import { test } from "node:test"
import { cells, layout, sheetCount, SHEET_SIZES, type LayoutInput, type Placement, type Sheet } from "./layout.ts"
import type { Item, PrintOptions } from "./print-options.ts"

// A made-up sheet with round numbers: 600 × 800 pt, and a different margin on every side.
const sheet = { width: 600, height: 800 }
const margins = { top: 20, right: 30, bottom: 40, left: 10 }
// So the printable area is 560 × 740 pt, from 10 pt from the left and 20 pt from the top.

/** One item per page or photo of the file, in its order: how often each prints. None is turned. */
const each = (...counts: number[]): Item[] => counts.map(count => ({ count, turn: 0 }))

const twoPerSheet = { kind: "grid", perSheet: 2 } as const

const options = (changes: Partial<PrintOptions> = {}): PrintOptions => ({
  copies: 1,
  color: "color",
  paper: "A4",
  quality: "normal",
  printSize: { kind: "percent", value: 100 },
  position: "center",
  layout: { kind: "grid", perSheet: 1 },
  items: each(1),
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

type PlacedBox = Pick<Placement, "scale" | "left" | "top" | "width" | "height">
const box = (sheets: Sheet[]): PlacedBox => {
  const { scale, left, top, width, height } = only(sheets)
  return { scale, left, top, width, height }
}

const fit = { kind: "fit" } as const
const fill = { kind: "fill" } as const
const percent = (value: number) => ({ kind: "percent", value }) as const

test("Print size: Einpassen fits inside the printable area, Füllen covers the sheet, a percentage scales from the natural size", async t => {
  const cases: [string, [number, number], PrintOptions["printSize"], PlacedBox][] = [
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
  const cases: [PrintOptions["paper"], PrintOptions["printSize"], PlacedBox][] = [
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

/** What sits where: one entry per sheet, each a list of `[ref, left, top, width, height]`. */
const summary = (sheets: Sheet[]) =>
  rounded(sheets).map(s => s.placements.map(p => [p.ref, p.left, p.top, p.width, p.height]))

test("the counts decide which PDF pages appear, in the file's order, one page per sheet", () => {
  const source = pdf([300, 400], [200, 100], [100, 150])
  const sheets = (...counts: number[]) => summary(layout({ source, options: options({ items: each(...counts), position: "top-left" }), sheet, margins }))

  assert.deepEqual(sheets(1, 0, 1), [[[1, 10, 20, 300, 400]], [[3, 10, 20, 100, 150]]])
  assert.deepEqual(sheets(0, 1, 0), [[[2, 10, 20, 200, 100]]])
  assert.deepEqual(sheets(0, 0, 0), [])
})

test("an item's turn turns a PDF page clockwise in 90° steps", async t => {
  // A 400 × 200 page at 100 % in the top-left corner of the printable area. In the matrix, y counts up from the sheet's bottom edge.
  const cases: [Item["turn"], size: [number, number], matrix: number[]][] = [
    [0, [400, 200], [1, 0, 0, 1, 10, 580]],
    [90, [200, 400], [0, -1, 1, 0, 10, 780]],
    [180, [400, 200], [-1, 0, 0, -1, 410, 780]],
    [270, [200, 400], [0, 1, -1, 0, 210, 380]],
  ]
  for (const [turn, [width, height], matrix] of cases) {
    await t.test(`${turn}°`, () => {
      const placement = only(layout({ source: pdf([400, 200]), options: options({ items: [{ count: 1, turn }], position: "top-left" }), sheet, margins }))
      assert.deepEqual(placement, { ref: 1, rotation: turn, scale: 1, left: 10, top: 20, width, height, matrix, clip: { left: 0, top: 0, width: 600, height: 800 } })
    })
  }

  await t.test("Print size applies to the turned page", () => {
    const turned = layout({ source: pdf([400, 200]), options: options({ items: [{ count: 1, turn: 90 }], printSize: fit }), sheet, margins })
    assert.deepEqual(box(turned), { scale: 1.85, left: 105, top: 20, width: 370, height: 740 })
  })
})

type Orientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
const photos = (...sizes: [width: number, height: number, orientation?: Orientation][]): LayoutInput["source"] => ({
  kind: "photos",
  photos: sizes.map(([width, height, orientation = 1]) => ({ width, height, orientation })),
})

test("the natural size of a photo is its pixels at 300 dpi", async t => {
  // 1500 × 2100 px are 5 × 7 inches, so 360 × 504 pt.
  const cases: [number, PlacedBox, matrix: number[]][] = [
    [100, { scale: 1, left: 10, top: 20, width: 360, height: 504 }, [1, 0, 0, 1, 10, 276]],
    [50, { scale: 0.5, left: 10, top: 20, width: 180, height: 252 }, [0.5, 0, 0, 0.5, 10, 528]],
    [200, { scale: 2, left: 10, top: 20, width: 720, height: 1008 }, [2, 0, 0, 2, 10, -228]],
  ]
  for (const [value, expected, matrix] of cases) {
    await t.test(`${value} %`, () => {
      const sheets = layout({ source: photos([1500, 2100]), options: options({ printSize: percent(value), position: "top-left" }), sheet, margins })
      assert.deepEqual(box(sheets), expected)
      assert.deepEqual(only(sheets).matrix, matrix)
    })
  }
})

test("the counts decide which photos appear, in the file's order, counted from 0, one photo per sheet", () => {
  const source = photos([300, 600], [600, 900], [900, 1200])
  const sheets = (changes: Partial<PrintOptions>) => summary(layout({ source, options: options({ position: "top-left", ...changes }), sheet, margins }))

  assert.deepEqual(sheets({ items: each(1, 0, 1) }), [[[0, 10, 20, 72, 144]], [[2, 10, 20, 216, 288]]])
  assert.deepEqual(sheets({ items: each(1, 1, 1), layout: twoPerSheet }), [[[0, 10, 20, 72, 144]], [[1, 10, 20, 144, 216]], [[2, 10, 20, 216, 288]]])
  assert.deepEqual(sheets({ items: each(0, 0, 0) }), [])
})

test("a photo comes out upright for each of the 8 EXIF orientations", async t => {
  // A photo stored as 1000 × 500 px (240 × 120 pt), at 100 % in the top-left corner of the printable area.
  // Its stored corners, in the matrix's coordinates (y counts up):
  const stored = { topLeft: [0, 120], topRight: [240, 120], bottomLeft: [0, 0], bottomRight: [240, 0] }
  type Corner = keyof typeof stored
  // Per orientation: which stored corners the EXIF standard shows at the top-left and the top-right, and the upright size.
  const cases: [Orientation, topLeft: Corner, topRight: Corner, size: [number, number], matrix: number[]][] = [
    [1, "topLeft", "topRight", [240, 120], [1, 0, 0, 1, 10, 660]],
    [2, "topRight", "topLeft", [240, 120], [-1, 0, 0, 1, 250, 660]],
    [3, "bottomRight", "bottomLeft", [240, 120], [-1, 0, 0, -1, 250, 780]],
    [4, "bottomLeft", "bottomRight", [240, 120], [1, 0, 0, -1, 10, 780]],
    [5, "topLeft", "bottomLeft", [120, 240], [0, -1, -1, 0, 130, 780]],
    [6, "bottomLeft", "topLeft", [120, 240], [0, -1, 1, 0, 10, 780]],
    [7, "bottomRight", "topRight", [120, 240], [0, 1, 1, 0, 10, 540]],
    [8, "topRight", "bottomRight", [120, 240], [0, 1, -1, 0, 130, 540]],
  ]
  for (const [orientation, topLeft, topRight, [width, height], matrix] of cases) {
    await t.test(`orientation ${orientation}`, () => {
      const source = photos([1000, 500, orientation])
      const placement = only(layout({ source, options: options({ position: "top-left" }), sheet, margins }))
      const onSheet = ([x, y]: number[]) => {
        const [a, b, c, d, e, f] = placement.matrix
        return [a * x! + c * y! + e, b * x! + d * y! + f]
      }

      assert.deepEqual(placement, { ref: 0, rotation: 0, scale: 1, left: 10, top: 20, width, height, matrix, clip: { left: 0, top: 0, width: 600, height: 800 } })
      // The box's top edge is 780 pt above the sheet's bottom edge.
      assert.deepEqual(onSheet(stored[topLeft]), [10, 780])
      assert.deepEqual(onSheet(stored[topRight]), [10 + width, 780])
    })
  }
})

test("auto-rotate turns a photo that lies across the sheet, at Einpassen and Füllen only; a PDF never turns", async t => {
  const portrait = sheet
  const landscape = { width: 800, height: 600 } // printable area 760 × 540
  const landscapePhoto = photos([1000, 500]) // 240 × 120 pt
  const portraitPhoto = photos([500, 1000]) // 120 × 240 pt
  type Expected = [rotation: number, left: number, top: number, width: number, height: number]
  const cases: [string, LayoutInput["source"], typeof sheet, PrintOptions["printSize"], Expected][] = [
    ["landscape photo, portrait sheet, Einpassen: turns", landscapePhoto, portrait, fit, [90, 105, 20, 370, 740]],
    ["landscape photo, portrait sheet, Füllen: turns", landscapePhoto, portrait, fill, [90, -10, -210, 600, 1200]],
    ["landscape photo, portrait sheet, 100 %: stays", landscapePhoto, portrait, percent(100), [0, 170, 330, 240, 120]],
    ["landscape photo, portrait sheet, 150 %: stays", landscapePhoto, portrait, percent(150), [0, 110, 300, 360, 180]],
    ["portrait photo, portrait sheet, Einpassen: stays", portraitPhoto, portrait, fit, [0, 105, 20, 370, 740]],
    ["portrait photo, landscape sheet, Einpassen: turns", portraitPhoto, landscape, fit, [90, 10, 100, 760, 380]],
    ["portrait photo, landscape sheet, Füllen: turns", portraitPhoto, landscape, fill, [90, -210, -10, 1200, 600]],
    ["landscape photo, landscape sheet, Einpassen: stays", landscapePhoto, landscape, fit, [0, 10, 100, 760, 380]],
    ["square photo, portrait sheet, Einpassen: stays", photos([500, 500]), portrait, fit, [0, 10, 110, 560, 560]],
    ["stored landscape but upright portrait (EXIF 6), portrait sheet: stays", photos([1000, 500, 6]), portrait, fit, [0, 105, 20, 370, 740]],
    ["stored portrait but upright landscape (EXIF 8), portrait sheet: turns", photos([500, 1000, 8]), portrait, fit, [90, 105, 20, 370, 740]],
    ["landscape PDF page, portrait sheet, Einpassen: stays", pdf([400, 200]), portrait, fit, [0, 10, 250, 560, 280]],
    ["landscape PDF page, portrait sheet, Füllen: stays", pdf([400, 200]), portrait, fill, [0, -510, -10, 1600, 800]],
    ["portrait PDF page, landscape sheet, Einpassen: stays", pdf([200, 400]), landscape, fit, [0, 255, 20, 270, 540]],
  ]
  for (const [name, source, size, printSize, expected] of cases) {
    await t.test(name, () => {
      const { rotation, left, top, width, height } = only(layout({ source, options: options({ printSize }), sheet: size, margins }))
      assert.deepEqual([rotation, left, top, width, height], expected)
    })
  }

  await t.test("the turn is clockwise: the photo's top-left corner ends at the top right", () => {
    const { matrix } = only(layout({ source: landscapePhoto, options: options({ printSize: fit }), sheet, margins }))
    // 370 × 740 pt, from 105 pt from the left and 40 pt above the bottom edge. The stored top-left corner is (0, 120).
    assert.deepEqual(matrix, [0, -3.08, 3.08, 0, 105, 780])
  })
})

test("an item's turn turns its page or photo by its own amount, on top of EXIF and auto-rotate", async t => {
  const turns = (sheets: Sheet[]) => rounded(sheets).map(s => s.placements.map(p => [p.ref, p.rotation, p.width, p.height]))
  const turned = (...by: Item["turn"][]): Item[] => by.map(turn => ({ count: 1, turn }))
  const three = photos([1000, 500], [500, 1000], [1000, 500]) // 240 × 120, 120 × 240, 240 × 120 pt

  await t.test("each photo has its own turn", () => {
    const sheets = layout({ source: three, options: options({ items: turned(90, 0, 180) }), sheet, margins })
    assert.deepEqual(turns(sheets), [[[0, 90, 120, 240]], [[1, 0, 120, 240]], [[2, 180, 240, 120]]])
  })

  await t.test("each PDF page has its own turn", () => {
    const sheets = layout({ source: pdf([400, 200], [400, 200], [400, 200]), options: options({ items: turned(90, 0, 270) }), sheet, margins })
    assert.deepEqual(turns(sheets), [[[1, 90, 200, 400]], [[2, 0, 400, 200]], [[3, 270, 200, 400]]])
  })

  await t.test("it adds to auto-rotate: a landscape photo at Einpassen turned once more lies across the sheet", () => {
    const once = layout({ source: three, options: options({ printSize: fit, items: turned(90) }), sheet, margins })
    assert.deepEqual(turns(once), [[[0, 180, 560, 280]]])
    const back = layout({ source: three, options: options({ printSize: fit, items: turned(270) }), sheet, margins })
    assert.deepEqual(turns(back), [[[0, 0, 560, 280]]])
  })

  await t.test("it adds to the EXIF orientation: stored on its side (EXIF 6), then turned 90°, makes half a turn", () => {
    const source = photos([1000, 500, 6])
    const placement = only(layout({ source, options: options({ position: "top-left", items: turned(90) }), sheet, margins }))
    assert.deepEqual(placement, { ref: 0, rotation: 90, scale: 1, left: 10, top: 20, width: 240, height: 120, matrix: [-1, 0, 0, -1, 250, 780], clip: { left: 0, top: 0, width: 600, height: 800 } })
  })
})

test("two pages per sheet on a landscape sheet: two halves side by side, each laid out as its own sheet", async t => {
  // An 800 × 600 sheet. The left half prints from 10 to 400 pt across, the right half from 400 to 770; both from 20 to 560 down.
  const landscape = { width: 800, height: 600 }
  const two = (source: LayoutInput["source"], changes: Partial<PrintOptions>) =>
    layout({ source, options: options({ layout: twoPerSheet, ...changes }), sheet: landscape, margins })

  await t.test("Einpassen fits each page into its half; an odd number of pages leaves the last half empty", () => {
    const sheets = two(pdf([200, 400], [200, 400], [200, 400]), { items: each(1, 1, 1), printSize: fit })
    assert.deepEqual(summary(sheets), [
      [[1, 70, 20, 270, 540], [2, 450, 20, 270, 540]],
      [[3, 70, 20, 270, 540]],
    ])
    assert.deepEqual(sheets[0]!.placements.map(p => [p.rotation, p.clip]), [
      [0, { left: 0, top: 0, width: 400, height: 600 }],
      [0, { left: 400, top: 0, width: 400, height: 600 }],
    ])
    assert.deepEqual(rounded(sheets[0]!.placements.map(p => p.matrix)), [[1.35, 0, 0, 1.35, 70, 40], [1.35, 0, 0, 1.35, 450, 40]])
  })

  await t.test("the pages fill the halves in the file's order", () => {
    const sheets = two(pdf([100, 100], [110, 110], [120, 120], [130, 130]), { items: each(1, 1, 0, 1), position: "top-left" })
    assert.deepEqual(summary(sheets), [
      [[1, 10, 20, 100, 100], [2, 400, 20, 110, 110]],
      [[4, 10, 20, 130, 130]],
    ])
  })

  await t.test("Position applies inside each half", async t => {
    const cases: [PrintOptions["position"], first: [left: number, top: number], second: [left: number, top: number]][] = [
      ["top-left", [10, 20], [400, 20]],
      ["top", [155, 20], [535, 20]],
      ["top-right", [300, 20], [670, 20]],
      ["left", [10, 240], [400, 240]],
      ["center", [155, 240], [535, 240]],
      ["right", [300, 240], [670, 240]],
      ["bottom-left", [10, 460], [400, 460]],
      ["bottom", [155, 460], [535, 460]],
      ["bottom-right", [300, 460], [670, 460]],
    ]
    for (const [position, first, second] of cases) {
      await t.test(position, () => {
        const sheets = two(pdf([100, 100], [100, 100]), { items: each(1, 1), position })
        assert.deepEqual(summary(sheets), [[[1, ...first, 100, 100], [2, ...second, 100, 100]]])
      })
    }
  })

  await t.test("Füllen covers each half, and each page keeps to its half", () => {
    const [first] = two(pdf([200, 400], [200, 400]), { items: each(1, 1), printSize: fill })
    assert.deepEqual(summary([first!]), [[[1, 5, -110, 400, 800], [2, 385, -110, 400, 800]]])
    assert.deepEqual(first!.placements.map(p => p.clip), [{ left: 0, top: 0, width: 400, height: 600 }, { left: 400, top: 0, width: 400, height: 600 }])
  })

  await t.test("the flags look at both halves", () => {
    const flags = (sheets: Sheet[]) => sheets.map(s => [s.cutOff, s.emptySpace])
    // 390 × 540 and 370 × 540 are exactly what each half can print.
    const exact = pdf([390, 540], [370, 540], [300, 300], [391, 540], [370, 540], [390, 540])
    assert.deepEqual(flags(two(exact, { items: each(1, 1) })), [[false, false]])
    assert.deepEqual(flags(two(exact, { items: each(1, 0, 1) })), [[false, true]])
    assert.deepEqual(flags(two(exact, { items: each(0, 0, 0, 1, 1) })), [[true, false]])
    assert.deepEqual(flags(two(exact, { items: each(1, 1, 0, 0, 0, 1) })), [[false, false], [false, true]])
    assert.deepEqual(flags(two(exact, { items: each(1, 1), printSize: fill })), [[true, false]])
  })
})

test("two pages per sheet on a portrait sheet: the halves lie side by side once the sheet is turned", async t => {
  // The 600 × 800 sheet is read turned a quarter, so the pages lie on it turned 90° clockwise: page tops at the sheet's right edge.
  // The first half is the sheet's top half (prints 10 to 570 across, 20 to 400 down), the second its bottom half (400 to 760 down).
  const two = (source: LayoutInput["source"], changes: Partial<PrintOptions>) =>
    layout({ source, options: options({ layout: twoPerSheet, ...changes }), sheet, margins })
  const top = { left: 0, top: 0, width: 600, height: 400 }
  const bottom = { left: 0, top: 400, width: 600, height: 400 }

  await t.test("Einpassen: two portrait pages, each across one half", () => {
    const sheets = two(pdf([200, 400], [200, 400], [200, 400]), { items: each(1, 1, 1), printSize: fit })
    assert.deepEqual(rounded(sheets), [
      {
        placements: [
          { ref: 1, rotation: 90, scale: 1.4, left: 10, top: 70, width: 560, height: 280, matrix: [0, -1.4, 1.4, 0, 10, 730], clip: top },
          { ref: 2, rotation: 90, scale: 1.4, left: 10, top: 440, width: 560, height: 280, matrix: [0, -1.4, 1.4, 0, 10, 360], clip: bottom },
        ],
        cutOff: false,
        emptySpace: true,
        sideways: true,
      },
      {
        placements: [{ ref: 3, rotation: 90, scale: 1.4, left: 10, top: 70, width: 560, height: 280, matrix: [0, -1.4, 1.4, 0, 10, 730], clip: top }],
        cutOff: false,
        emptySpace: true,
        sideways: true,
      },
    ])
  })

  await t.test("Position is the reader's: top-left is the sheet's top-right corner", async t => {
    // 100 × 150 pages at 100 % take up 150 × 100 on the sheet.
    const cases: [PrintOptions["position"], first: [left: number, top: number], second: [left: number, top: number]][] = [
      ["top-left", [420, 20], [420, 400]],
      ["top", [420, 160], [420, 530]],
      ["top-right", [420, 300], [420, 660]],
      ["left", [215, 20], [215, 400]],
      ["center", [215, 160], [215, 530]],
      ["right", [215, 300], [215, 660]],
      ["bottom-left", [10, 20], [10, 400]],
      ["bottom", [10, 160], [10, 530]],
      ["bottom-right", [10, 300], [10, 660]],
    ]
    for (const [position, first, second] of cases) {
      await t.test(position, () => {
        const sheets = two(pdf([100, 150], [100, 150]), { items: each(1, 1), position })
        assert.deepEqual(summary(sheets), [[[1, ...first, 150, 100], [2, ...second, 150, 100]]])
      })
    }
  })

  await t.test("an item's turn adds to the quarter turn of the sheet", () => {
    const turns = (turn: Item["turn"]) =>
      rounded(two(pdf([400, 200]), { items: [{ count: 1, turn }], printSize: fit })).map(s => s.placements.map(p => [p.rotation, p.left, p.top, p.width, p.height]))
    // A landscape page across the turned half is small.
    assert.deepEqual(turns(0), [[[90, 195, 20, 190, 380]]])
    // Turned three times it stands upright on the portrait sheet and fills the half's width.
    assert.deepEqual(turns(270), [[[0, 10, 70, 560, 280]]])
    assert.deepEqual(turns(90), [[[180, 10, 70, 560, 280]]])
  })

  await t.test("on A4 with the Printer's margins, two A4 pages of 595 × 842 pt print at 69 %", () => {
    const edge = { top: 12, right: 9, bottom: 12, left: 9 }
    const sheets = layout({ source: pdf([595, 842], [595, 842]), options: options({ layout: twoPerSheet, items: each(1, 1), printSize: fit }), sheet: SHEET_SIZES.A4, margins: edge })
    assert.deepEqual(rounded(sheets), [
      {
        placements: [
          { ref: 1, rotation: 90, scale: 0.69, left: 9, top: 12.51, width: 577.28, height: 407.93, matrix: [0, -0.69, 0.69, 0, 9, 829.38], clip: { left: 0, top: 0, width: 595.28, height: 420.94 } },
          { ref: 2, rotation: 90, scale: 0.69, left: 9, top: 421.45, width: 577.28, height: 407.93, matrix: [0, -0.69, 0.69, 0, 9, 420.44], clip: { left: 0, top: 420.94, width: 595.28, height: 420.94 } },
        ],
        cutOff: false,
        emptySpace: true,
        sideways: true,
      },
    ])
  })

  await t.test("one page per sheet and photos are not sideways", () => {
    const [page] = layout({ source: pdf([200, 400]), options: options(), sheet, margins })
    assert.equal(page!.sideways, false)
    const [photo] = two(photos([500, 1000]), {})
    assert.equal(photo!.sideways, false)
  })
})

test("an item's count repeats its page or photo next to itself, and a count of 0 leaves it out", async t => {
  const refs = (sheets: Sheet[]) => sheets.map(s => s.placements.map(p => p.ref))
  const threePages = pdf([200, 300], [200, 300], [200, 300])
  const landscape = { width: 800, height: 600 }

  await t.test("one per sheet: a sheet for every repeat, in the file's order", () => {
    assert.deepEqual(refs(layout({ source: threePages, options: options({ items: each(2, 0, 3) }), sheet, margins })), [[1], [1], [3], [3], [3]])
    assert.deepEqual(refs(layout({ source: photos([900, 600], [900, 600], [900, 600]), options: options({ items: each(1, 2, 0) }), sheet, margins })), [[0], [1], [1]])
  })

  await t.test("two per sheet: A A B B, and the last sheet keeps its second half empty", () => {
    assert.deepEqual(refs(layout({ source: threePages, options: options({ items: each(2, 2, 1), layout: twoPerSheet }), sheet, margins })), [[1, 1], [2, 2], [3]])
  })

  await t.test("repeats that don't fill a sheet go on on the next one", () => {
    assert.deepEqual(refs(layout({ source: threePages, options: options({ items: each(3, 0, 2), layout: twoPerSheet }), sheet, margins })), [[1, 1], [1, 3], [3]])
  })

  await t.test("each repeat is laid out in its own Cell", () => {
    const sheets = layout({ source: threePages, options: options({ items: each(2, 0, 0), layout: twoPerSheet, position: "top-left" }), sheet: landscape, margins })
    assert.deepEqual(summary(sheets), [[[1, 10, 20, 200, 300], [1, 400, 20, 200, 300]]])
  })
})

test("an item's size replaces the Print size for that page or photo only", async t => {
  const sized = (...sizes: Item["size"][]): Item[] => sizes.map(size => ({ count: 1, turn: 0, ...(size && { size }) }))
  const scales = (sheets: Sheet[]) => rounded(sheets).map(s => s.placements.map(p => [p.ref, p.scale, p.left, p.top, p.width, p.height]))

  await t.test("PDF pages at 100 %: one stays, one is fitted into the printable area, one covers the sheet", () => {
    const source = pdf([300, 400], [300, 400], [300, 400])
    const sheets = layout({ source, options: options({ items: sized(undefined, "fit", "fill") }), sheet, margins })
    assert.deepEqual(scales(sheets), [[[1, 1, 140, 190, 300, 400]], [[2, 1.85, 12.5, 20, 555, 740]], [[3, 2, -10, -10, 600, 800]]])
    assert.deepEqual(sheets.map(s => s.cutOff), [false, false, true])
  })

  await t.test("Füllen for one page while the others are fitted", () => {
    const sheets = layout({ source: pdf([300, 400], [300, 400]), options: options({ printSize: fit, items: sized("fill", undefined) }), sheet, margins })
    assert.deepEqual(scales(sheets), [[[1, 2, -10, -10, 600, 800]], [[2, 1.85, 12.5, 20, 555, 740]]])
  })

  await t.test("a photo with a size of its own turns to the sheet, as at Einpassen and Füllen for all", () => {
    // 240 × 120 pt photos at 100 %
    const source = photos([1000, 500], [1000, 500], [1000, 500])
    const sheets = layout({ source, options: options({ items: sized(undefined, "fit", "fill") }), sheet, margins })
    assert.deepEqual(rounded(sheets).map(s => s.placements.map(p => [p.rotation, p.left, p.top, p.width, p.height])), [
      [[0, 170, 330, 240, 120]],
      [[90, 105, 20, 370, 740]],
      [[90, -10, -210, 600, 1200]],
    ])
  })

  await t.test("two per sheet: the size applies in the item's Cell", () => {
    const sheets = layout({ source: pdf([200, 400], [200, 400]), options: options({ layout: twoPerSheet, printSize: fit, items: sized(undefined, "fill") }), sheet: { width: 800, height: 600 }, margins })
    assert.deepEqual(summary(sheets), [[[1, 70, 20, 270, 540], [2, 385, -110, 400, 800]]])
  })
})

test("the Cells of a layout: the whole sheet, or two halves side by side as the sheet is read", async t => {
  await t.test("one per sheet: the whole sheet and its printable area", () => {
    assert.deepEqual(cells({ kind: "grid", perSheet: 1 }, sheet, margins), {
      cells: [{ box: { left: 0, top: 0, width: 600, height: 800 }, printable: { left: 10, top: 20, width: 560, height: 740 } }],
      sideways: false,
    })
  })

  await t.test("two per sheet on a landscape sheet: the left half, then the right half", () => {
    assert.deepEqual(cells(twoPerSheet, { width: 800, height: 600 }, margins), {
      cells: [
        { box: { left: 0, top: 0, width: 400, height: 600 }, printable: { left: 10, top: 20, width: 390, height: 540 } },
        { box: { left: 400, top: 0, width: 400, height: 600 }, printable: { left: 400, top: 20, width: 370, height: 540 } },
      ],
      sideways: false,
    })
  })

  await t.test("two per sheet on a portrait sheet, which is read sideways: the top half, then the bottom half", () => {
    assert.deepEqual(cells(twoPerSheet, sheet, margins), {
      cells: [
        { box: { left: 0, top: 0, width: 600, height: 400 }, printable: { left: 10, top: 20, width: 560, height: 380 } },
        { box: { left: 0, top: 400, width: 600, height: 400 }, printable: { left: 10, top: 400, width: 560, height: 360 } },
      ],
      sideways: true,
    })
  })

  await t.test("two per sheet on A4 with the Printer's margins", () => {
    assert.deepEqual(rounded(cells(twoPerSheet, SHEET_SIZES.A4, { top: 12, right: 9, bottom: 12, left: 9 })), {
      cells: [
        { box: { left: 0, top: 0, width: 595.28, height: 420.94 }, printable: { left: 9, top: 12, width: 577.28, height: 408.94 } },
        { box: { left: 0, top: 420.94, width: 595.28, height: 420.94 }, printable: { left: 9, top: 420.94, width: 577.28, height: 408.94 } },
      ],
      sideways: true,
    })
  })

  await t.test("layout() places into them: every placement is clipped to its Cell", () => {
    const sheets = layout({ source: pdf([200, 400], [200, 400], [200, 400]), options: options({ layout: twoPerSheet, items: each(1, 1, 1) }), sheet, margins })
    const [first, second] = cells(twoPerSheet, sheet, margins).cells
    assert.deepEqual(sheets.map(s => s.placements.map(p => p.clip)), [[first!.box, second!.box], [first!.box]])
  })
})

test("the sheet count of a Print Job is the sheets one copy takes, times the copies", async t => {
  const fivePages = pdf([200, 300], [200, 300], [200, 300], [200, 300], [200, 300])
  const threePhotos = photos([900, 600], [900, 600], [900, 600])
  const count = (source: LayoutInput["source"], changes: Partial<PrintOptions>) => {
    const chosen = options(changes)
    return sheetCount(layout({ source, options: chosen, sheet, margins }), chosen.copies)
  }

  await t.test("one page per sheet: a sheet for every page that prints", () => {
    assert.equal(count(fivePages, { items: each(1, 1, 1, 1, 1) }), 5)
    assert.equal(count(fivePages, { items: each(0, 1, 0, 0, 1) }), 2)
    assert.equal(count(fivePages, { items: each(0, 0, 0, 1, 0) }), 1)
  })

  await t.test("two pages per sheet: half as many, and an odd page takes a sheet of its own", () => {
    assert.equal(count(fivePages, { items: each(1, 1, 1, 1, 0), layout: twoPerSheet }), 2)
    assert.equal(count(fivePages, { items: each(1, 1, 1, 1, 1), layout: twoPerSheet }), 3)
    assert.equal(count(fivePages, { items: each(0, 0, 1, 0, 0), layout: twoPerSheet }), 1)
  })

  await t.test("every copy takes the same sheets again", () => {
    assert.equal(count(fivePages, { items: each(1, 1, 1, 1, 1), copies: 3 }), 15)
    assert.equal(count(fivePages, { items: each(0, 1, 0, 0, 1), copies: 4 }), 8)
    assert.equal(count(fivePages, { items: each(1, 1, 1, 1, 1), layout: twoPerSheet, copies: 2 }), 6)
  })

  await t.test("every repeat takes a Cell", () => {
    assert.equal(count(fivePages, { items: each(3, 0, 0, 0, 0) }), 3)
    assert.equal(count(fivePages, { items: each(2, 2, 0, 0, 1), layout: twoPerSheet, copies: 3 }), 9)
  })

  await t.test("photos take a sheet each", () => {
    assert.equal(count(threePhotos, { items: each(1, 1, 1) }), 3)
    assert.equal(count(threePhotos, { items: each(1, 0, 1), copies: 5 }), 10)
  })

  await t.test("nothing printed takes no paper", () => {
    assert.equal(count(fivePages, { items: each(0, 0, 0, 0, 0), copies: 3 }), 0)
  })
})
