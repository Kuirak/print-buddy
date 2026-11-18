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

/** What sits where: one entry per sheet, each a list of `[ref, left, top, width, height]`. */
const summary = (sheets: Sheet[]) =>
  rounded(sheets).map(s => s.placements.map(p => [p.ref, p.left, p.top, p.width, p.height]))

test("the selection decides which PDF pages appear and in which order, one page per sheet", () => {
  const source = pdf([300, 400], [200, 100], [100, 150])
  const sheets = (selection: number[]) => summary(layout({ source, options: options({ selection, position: "top-left" }), sheet, margins }))

  assert.deepEqual(sheets([3, 1]), [[[3, 10, 20, 100, 150]], [[1, 10, 20, 300, 400]]])
  assert.deepEqual(sheets([2]), [[[2, 10, 20, 200, 100]]])
  assert.deepEqual(sheets([]), [])
})

test("manual rotation turns a PDF page clockwise in 90° steps", async t => {
  // A 400 × 200 page at 100 % in the top-left corner of the printable area. In the matrix, y counts up from the sheet's bottom edge.
  const cases: [PrintOptions["rotation"], size: [number, number], matrix: number[]][] = [
    [0, [400, 200], [1, 0, 0, 1, 10, 580]],
    [90, [200, 400], [0, -1, 1, 0, 10, 780]],
    [180, [400, 200], [-1, 0, 0, -1, 410, 780]],
    [270, [200, 400], [0, 1, -1, 0, 210, 380]],
  ]
  for (const [rotation, [width, height], matrix] of cases) {
    await t.test(`${rotation}°`, () => {
      const placement = only(layout({ source: pdf([400, 200]), options: options({ rotation, position: "top-left" }), sheet, margins }))
      assert.deepEqual(placement, { ref: 1, rotation, scale: 1, left: 10, top: 20, width, height, matrix, clip: { left: 0, top: 0, width: 600, height: 800 } })
    })
  }

  await t.test("Print size applies to the turned page", () => {
    const turned = layout({ source: pdf([400, 200]), options: options({ rotation: 90, printSize: fit }), sheet, margins })
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
  const cases: [number, ReturnType<typeof box>, matrix: number[]][] = [
    [100, { scale: 1, left: 10, top: 20, width: 360, height: 504 }, [1, 0, 0, 1, 10, 276]],
    [50, { scale: 0.5, left: 10, top: 20, width: 180, height: 252 }, [0.5, 0, 0, 0.5, 10, 528]],
    [200, { scale: 2, left: 10, top: 20, width: 720, height: 1008 }, [2, 0, 0, 2, 10, -228]],
  ]
  for (const [value, expected, matrix] of cases) {
    await t.test(`${value} %`, () => {
      const sheets = layout({ source: photos([1500, 2100]), options: options({ selection: [0], printSize: percent(value), position: "top-left" }), sheet, margins })
      assert.deepEqual(box(sheets), expected)
      assert.deepEqual(only(sheets).matrix, matrix)
    })
  }
})

test("the selection decides which photos appear and in which order, counted from 0, one photo per sheet", () => {
  const source = photos([300, 600], [600, 900], [900, 1200])
  const sheets = (changes: Partial<PrintOptions>) => summary(layout({ source, options: options({ position: "top-left", ...changes }), sheet, margins }))

  assert.deepEqual(sheets({ selection: [2, 0] }), [[[2, 10, 20, 216, 288]], [[0, 10, 20, 72, 144]]])
  assert.deepEqual(sheets({ selection: [0, 1, 2], pagesPerSheet: 2 }), [[[0, 10, 20, 72, 144]], [[1, 10, 20, 144, 216]], [[2, 10, 20, 216, 288]]])
  assert.deepEqual(sheets({ selection: [] }), [])
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
      const placement = only(layout({ source, options: options({ selection: [0], position: "top-left" }), sheet, margins }))
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
      const selection = source.kind === "pdf" ? [1] : [0]
      const { rotation, left, top, width, height } = only(layout({ source, options: options({ selection, printSize }), sheet: size, margins }))
      assert.deepEqual([rotation, left, top, width, height], expected)
    })
  }

  await t.test("the turn is clockwise: the photo's top-left corner ends at the top right", () => {
    const { matrix } = only(layout({ source: landscapePhoto, options: options({ selection: [0], printSize: fit }), sheet, margins }))
    // 370 × 740 pt, from 105 pt from the left and 40 pt above the bottom edge. The stored top-left corner is (0, 120).
    assert.deepEqual(matrix, [0, -3.08, 3.08, 0, 105, 780])
  })
})

test("manual rotation turns each photo by its own amount, on top of EXIF and auto-rotate", async t => {
  const turns = (sheets: Sheet[]) => rounded(sheets).map(s => s.placements.map(p => [p.ref, p.rotation, p.width, p.height]))
  const three = photos([1000, 500], [500, 1000], [1000, 500]) // 240 × 120, 120 × 240, 240 × 120 pt

  await t.test("each photo has its own rotation", () => {
    const sheets = layout({ source: three, options: options({ selection: [0, 1, 2], photoRotations: { 0: 90, 2: 180 } }), sheet, margins })
    assert.deepEqual(turns(sheets), [[[0, 90, 120, 240]], [[1, 0, 120, 240]], [[2, 180, 240, 120]]])
  })

  await t.test("the rotation of the whole PDF doesn't turn photos", () => {
    const sheets = layout({ source: three, options: options({ selection: [0, 1], rotation: 90 }), sheet, margins })
    assert.deepEqual(turns(sheets), [[[0, 0, 240, 120]], [[1, 0, 120, 240]]])
  })

  await t.test("photo rotations don't turn PDF pages", () => {
    const sheets = layout({ source: pdf([400, 200], [400, 200]), options: options({ selection: [1, 2], rotation: 90, photoRotations: { 1: 180 } }), sheet, margins })
    assert.deepEqual(turns(sheets), [[[1, 90, 200, 400]], [[2, 90, 200, 400]]])
  })

  await t.test("it adds to auto-rotate: a landscape photo at Einpassen turned once more lies across the sheet", () => {
    const once = layout({ source: three, options: options({ selection: [0], printSize: fit, photoRotations: { 0: 90 } }), sheet, margins })
    assert.deepEqual(turns(once), [[[0, 180, 560, 280]]])
    const back = layout({ source: three, options: options({ selection: [0], printSize: fit, photoRotations: { 0: 270 } }), sheet, margins })
    assert.deepEqual(turns(back), [[[0, 0, 560, 280]]])
  })

  await t.test("it adds to the EXIF orientation: stored on its side (EXIF 6), then turned 90°, makes half a turn", () => {
    const source = photos([1000, 500, 6])
    const placement = only(layout({ source, options: options({ selection: [0], position: "top-left", photoRotations: { 0: 90 } }), sheet, margins }))
    assert.deepEqual(placement, { ref: 0, rotation: 90, scale: 1, left: 10, top: 20, width: 240, height: 120, matrix: [-1, 0, 0, -1, 250, 780], clip: { left: 0, top: 0, width: 600, height: 800 } })
  })
})
