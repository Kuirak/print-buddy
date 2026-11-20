import assert from "node:assert/strict"
import { test } from "node:test"
import type { Item, PrintOptions } from "../shared/print-options.ts"
import type { FakeIpp } from "./testing/fake-ipp.ts"
import { encryptedPdf, items, pdfWithPages, sampleJpeg, samplePng, samplePrintOptions as base, withExifOrientation, type PdfPageSpec } from "./testing/fixtures.ts"
import { startTestServer, type TestServer } from "./testing/harness.ts"
import { readRenderedPdf } from "./testing/rendered-pdf.ts"

// Sheet sizes in points: A4 is 595.28 × 841.89, A5 419.53 × 595.28, Umschlag DL 311.81 × 623.62, Umschlag C5 459.21 × 649.13.

/** A printer that can print up to the edge, so the expected numbers stay simple. */
const noMargins = (printer: FakeIpp) => {
  for (const media of printer.printer.media) Object.assign(media, { top: 0, right: 0, bottom: 0, left: 0 })
}

async function start(t: { after(fn: () => unknown): void }, margins: "none" | "printer" = "none") {
  const server = await startTestServer(margins === "none" ? { beforeStart: noMargins } : {})
  t.after(server.close)
  return server
}

/** Uploads the files into a new draft, submits it and returns the sheets of the PDF the printer received. */
async function print(server: TestServer, files: Uint8Array<ArrayBuffer>[], options: Partial<PrintOptions>) {
  const { draftId } = await (await server.post("/api/drafts")).json() as { draftId: string }
  for (const file of files) assert.equal((await server.upload(draftId, file, "file")).status, 201)
  const submitted = await server.submit(draftId, options)
  assert.equal(submitted.status, 201, await submitted.clone().text())
  return readRenderedPdf(server.printer.requests.at(-1)!.data)
}

const printPdf = (server: TestServer, pages: PdfPageSpec[], options: Partial<PrintOptions>) => print(server, [pdfWithPages(pages)], options)

const actualSize: Partial<PrintOptions> = { printSize: { kind: "percent", value: 100 }, position: "top-left" }

test("the Printer receives a PDF built from the selected page, on a sheet of the chosen paper", async t => {
  const server = await start(t)

  const sheets = await printPdf(server, [{ size: [200, 100] }], actualSize)

  assert.equal(server.printer.requests.length, 1)
  assert.deepEqual(sheets, [{
    width: 595.28,
    height: 841.89,
    items: [{
      kind: "page",
      size: [200, 100],
      box: { left: 0, top: 0, width: 200, height: 100 },
      clip: { left: 0, top: 0, width: 595.28, height: 841.89 },
      corners: [[0, 100], [200, 100], [0, 0], [200, 0]],
    }],
  }])
})

test("each sheet has the size of the chosen paper", async t => {
  const server = await start(t)
  const sizes = { A4: [595.28, 841.89], A5: [419.53, 595.28], EnvDL: [311.81, 623.62], EnvC5: [459.21, 649.13] } as const

  for (const paper of ["A4", "A5", "EnvDL", "EnvC5"] as const) {
    const sheets = await printPdf(server, [{ size: [200, 100] }, { size: [300, 100] }], { ...actualSize, paper, items: items(1, 1) })

    assert.deepEqual(sheets.map(sheet => [sheet.width, sheet.height]), [sizes[paper], sizes[paper]], paper)
    assert.deepEqual(sheets[0]!.items[0]!.clip, { left: 0, top: 0, width: sizes[paper][0], height: sizes[paper][1] }, paper)
  }
})

test("only the pages with a count are printed, in the file's order", async t => {
  const server = await start(t)
  const pages: PdfPageSpec[] = [{ size: [100, 100] }, { size: [200, 100] }, { size: [300, 100] }, { size: [400, 100] }]

  const sheets = await printPdf(server, pages, { ...actualSize, items: items(1, 0, 1, 1) })

  assert.deepEqual(sheets.map(sheet => sheet.items.map(item => item.size)), [[[100, 100]], [[300, 100]], [[400, 100]]])
})

test("a page prints the way a reader shows it: turned by its own rotation, cut to its CropBox", async t => {
  const server = await start(t)
  const pages: PdfPageSpec[] = [
    { size: [300, 400], rotate: 90 },
    { size: [300, 400], rotate: 180 },
    { size: [300, 400], rotate: 270 },
    { size: [200, 100], cropBox: [10, 10, 110, 60] },
    { size: [200, 100], cropBox: [10, 10, 110, 60], rotate: 90 },
  ]

  const sheets = await printPdf(server, pages, { ...actualSize, items: items(1, 1, 1, 1, 1) })

  // corners of the stored page: bottom-left, bottom-right, top-left, top-right
  assert.deepEqual(sheets.map(sheet => sheet.items.map(({ size, box, corners }) => ({ size, box, corners }))), [
    [{ size: [300, 400], box: { left: 0, top: 0, width: 400, height: 300 }, corners: [[0, 0], [0, 300], [400, 0], [400, 300]] }],
    [{ size: [300, 400], box: { left: 0, top: 0, width: 300, height: 400 }, corners: [[300, 0], [0, 0], [300, 400], [0, 400]] }],
    [{ size: [300, 400], box: { left: 0, top: 0, width: 400, height: 300 }, corners: [[400, 300], [400, 0], [0, 300], [0, 0]] }],
    [{ size: [100, 50], box: { left: 0, top: 0, width: 100, height: 50 }, corners: [[0, 50], [100, 50], [0, 0], [100, 0]] }],
    [{ size: [100, 50], box: { left: 0, top: 0, width: 50, height: 100 }, corners: [[0, 0], [0, 100], [50, 0], [50, 100]] }],
  ])
})

test("the part of a page that prints is the part a reader shows: the CropBox only as far as it lies on the page, turned by quarter turns only", async t => {
  const server = await start(t)
  // the pages of the upload intake test with the same name
  const pages: PdfPageSpec[] = [
    { size: [200, 100], cropBox: [-50, -20, 150, 300] },
    { size: [200, 100], cropBox: [150, 60, 20, 10] },
    { size: [200, 100], cropBox: [300, 300, 400, 400] },
    { size: [200, 100], cropBox: [-50, 0, 150, 100], rotate: 90 },
    { size: [200, 100], rotate: 45 },
    { size: [200, 100], rotate: 450 },
  ]

  const sheets = await printPdf(server, pages, { ...actualSize, items: items(1, 1, 1, 1, 1, 1) })

  assert.deepEqual(sheets.map(sheet => sheet.items.map(({ size, box }) => ({ size, box }))), [
    [{ size: [150, 100], box: { left: 0, top: 0, width: 150, height: 100 } }],
    [{ size: [130, 50], box: { left: 0, top: 0, width: 130, height: 50 } }],
    [{ size: [200, 100], box: { left: 0, top: 0, width: 200, height: 100 } }],
    [{ size: [150, 100], box: { left: 0, top: 0, width: 100, height: 150 } }],
    [{ size: [200, 100], box: { left: 0, top: 0, width: 200, height: 100 } }],
    [{ size: [200, 100], box: { left: 0, top: 0, width: 100, height: 200 } }],
  ])
})

test("Print size and Position place a page where the layout module says", async t => {
  const server = await start(t, "printer")
  const cases: { options: Partial<PrintOptions>; box: { left: number; top: number; width: number; height: number } }[] = [
    // the Printer's margins are 9.01 pt left and right, 11.99 pt top and bottom: Einpassen fills the 577.26 pt between them
    { options: { printSize: { kind: "fit" }, position: "center" }, box: { left: 9.01, top: 276.63, width: 577.26, height: 288.63 } },
    { options: { printSize: { kind: "fit" }, position: "top" }, box: { left: 9.01, top: 11.99, width: 577.26, height: 288.63 } },
    { options: { printSize: { kind: "fit" }, position: "bottom-right" }, box: { left: 9.01, top: 541.27, width: 577.26, height: 288.63 } },
    // Füllen covers the whole sheet in height, so the page is 1683.78 pt wide; Position decides which part is cut off
    { options: { printSize: { kind: "fill" }, position: "left" }, box: { left: 9.01, top: 0, width: 1683.78, height: 841.89 } },
    { options: { printSize: { kind: "fill" }, position: "right" }, box: { left: -1097.51, top: 0, width: 1683.78, height: 841.89 } },
    { options: { printSize: { kind: "percent", value: 50 }, position: "top-left" }, box: { left: 9.01, top: 11.99, width: 100, height: 50 } },
    { options: { printSize: { kind: "percent", value: 250 }, position: "bottom-right" }, box: { left: 86.27, top: 579.9, width: 500, height: 250 } },
    { options: { printSize: { kind: "percent", value: 400 }, position: "top-left" }, box: { left: 9.01, top: 11.99, width: 800, height: 400 } },
  ]

  for (const { options, box } of cases) {
    const sheets = await printPdf(server, [{ size: [200, 100] }], options)

    assert.deepEqual(sheets.map(sheet => sheet.items.map(item => item.box)), [[box]], JSON.stringify(options))
  }
})

test("each page turns by its item's turn; a PDF is never turned on its own", async t => {
  const server = await start(t)
  const pages: PdfPageSpec[] = [{ size: [200, 100] }, { size: [300, 100] }]
  const corners = (sheets: Awaited<ReturnType<typeof printPdf>>) => sheets.map(sheet => sheet.items.map(item => item.corners))

  const turned = (...turns: Item["turn"][]) => turns.map(turn => ({ count: 1, turn }))

  assert.deepEqual(corners(await printPdf(server, pages, { ...actualSize, items: turned(90, 0) })), [
    [[[0, 0], [0, 200], [100, 0], [100, 200]]],
    [[[0, 100], [300, 100], [0, 0], [300, 0]]],
  ])
  assert.deepEqual(corners(await printPdf(server, pages, { ...actualSize, items: [{ count: 1, turn: 180 }, { count: 0, turn: 0 }] })), [
    [[[200, 0], [0, 0], [200, 100], [0, 100]]],
  ])
  assert.deepEqual(corners(await printPdf(server, pages, { ...actualSize, items: [{ count: 1, turn: 270 }, { count: 0, turn: 0 }] })), [
    [[[100, 200], [100, 0], [0, 200], [0, 0]]],
  ])
  // a landscape page at Einpassen on a portrait sheet stays landscape
  assert.deepEqual(corners(await printPdf(server, pages, { printSize: { kind: "fit" }, items: items(1, 0) })), [
    [[[0, 569.76], [595.28, 569.76], [0, 272.13], [595.28, 272.13]]],
  ])
})

test("two pages per sheet: the pages lie turned in the two halves of the sheet, each clipped to its half", async t => {
  const server = await start(t)
  const pages: PdfPageSpec[] = [{ size: [100, 100] }, { size: [200, 100] }, { size: [300, 100] }]

  const sheets = await printPdf(server, pages, { ...actualSize, layout: { kind: "grid", perSheet: 2 }, items: items(1, 1, 1) })

  const top = { left: 0, top: 0, width: 595.28, height: 420.94 }
  const bottom = { left: 0, top: 420.94, width: 595.28, height: 420.94 }
  assert.deepEqual(sheets, [
    {
      width: 595.28,
      height: 841.89,
      items: [
        { kind: "page", size: [100, 100], box: { left: 495.28, top: 0, width: 100, height: 100 }, clip: top, corners: [[495.28, 0], [495.28, 100], [595.28, 0], [595.28, 100]] },
        { kind: "page", size: [200, 100], box: { left: 495.28, top: 420.94, width: 100, height: 200 }, clip: bottom, corners: [[495.28, 420.94], [495.28, 620.94], [595.28, 420.94], [595.28, 620.94]] },
      ],
    },
    {
      width: 595.28,
      height: 841.89,
      items: [
        { kind: "page", size: [300, 100], box: { left: 495.28, top: 0, width: 100, height: 300 }, clip: top, corners: [[495.28, 0], [495.28, 300], [595.28, 0], [595.28, 300]] },
      ],
    },
  ])
})

test("a page without content gives an empty sheet", async t => {
  const server = await start(t)

  const sheets = await printPdf(server, [{ size: [200, 100], blank: true }, { size: [300, 100] }], { ...actualSize, items: items(1, 1) })

  assert.deepEqual(sheets.map(sheet => sheet.items.map(item => item.size)), [[], [[300, 100]]])
})

test("a PDF with an owner password only is printed", async t => {
  const server = await start(t)

  const sheets = await print(server, [await encryptedPdf({ userPassword: "", ownerPassword: "secret" })], actualSize)

  assert.deepEqual(sheets.map(sheet => sheet.items.map(item => item.size)), [[[100, 100]]])
})

test("photos go out as one Print Job, one photo per sheet, in the order they were added, with their bytes as uploaded", async t => {
  const server = await start(t)
  const jpeg = sampleJpeg()

  const sheets = await print(server, [jpeg, samplePng(64, 48), samplePng(20, 10)], { ...actualSize, items: items(1, 1, 1) })

  assert.equal(server.printer.requests.length, 1)
  // at 100 % a photo prints at 300 dpi: 40 × 30 px are 9.6 × 7.2 pt
  assert.deepEqual(sheets.map(sheet => [sheet.width, sheet.height, ...sheet.items.map(({ kind, size, box, filter }) => ({ kind, size, box, filter }))]), [
    [595.28, 841.89, { kind: "photo", size: [40, 30], box: { left: 0, top: 0, width: 9.6, height: 7.2 }, filter: "/DCTDecode" }],
    [595.28, 841.89, { kind: "photo", size: [64, 48], box: { left: 0, top: 0, width: 15.36, height: 11.52 }, filter: "/FlateDecode" }],
    [595.28, 841.89, { kind: "photo", size: [20, 10], box: { left: 0, top: 0, width: 4.8, height: 2.4 }, filter: "/FlateDecode" }],
  ])
  assert.deepEqual(Buffer.from(sheets[0]!.items[0]!.bytes!), Buffer.from(jpeg))
})

test("left-out photos are absent and the others keep the order they were added in", async t => {
  const server = await start(t)

  const sheets = await print(server, [sampleJpeg(), samplePng(64, 48), samplePng(20, 10)], { ...actualSize, items: items(1, 0, 1) })

  assert.deepEqual(sheets.map(sheet => sheet.items.map(item => item.size)), [[[40, 30]], [[20, 10]]])
})

test("photos come out upright for all 8 EXIF orientations", async t => {
  const server = await start(t)
  // where the stored photo's corners (bottom-left, bottom-right, top-left, top-right) belong once it is upright,
  // from the EXIF definition of each orientation. The 40 × 30 px photo is 9.6 × 7.2 pt, or 7.2 × 9.6 pt when it lies on its side.
  const upright: Record<number, [number, number][]> = {
    1: [[0, 7.2], [9.6, 7.2], [0, 0], [9.6, 0]],
    2: [[9.6, 7.2], [0, 7.2], [9.6, 0], [0, 0]],
    3: [[9.6, 0], [0, 0], [9.6, 7.2], [0, 7.2]],
    4: [[0, 0], [9.6, 0], [0, 7.2], [9.6, 7.2]],
    5: [[7.2, 0], [7.2, 9.6], [0, 0], [0, 9.6]],
    6: [[0, 0], [0, 9.6], [7.2, 0], [7.2, 9.6]],
    7: [[0, 9.6], [0, 0], [7.2, 9.6], [7.2, 0]],
    8: [[7.2, 9.6], [7.2, 0], [0, 9.6], [0, 0]],
  }
  const photos = [1, 2, 3, 4, 5, 6, 7, 8].map(orientation => withExifOrientation(sampleJpeg(), orientation))

  const sheets = await print(server, photos, { ...actualSize, items: items(...photos.map(() => 1)) })

  assert.deepEqual(sheets.map(sheet => sheet.items.map(item => item.corners)), Object.values(upright).map(corners => [corners]))
  // the bytes still carry the EXIF data
  assert.deepEqual(Buffer.from(sheets[5]!.items[0]!.bytes!), Buffer.from(photos[5]!))
})

test("a landscape photo turns to fill the portrait sheet at Einpassen and Füllen, a portrait photo stays", async t => {
  const server = await start(t)
  const landscape = sampleJpeg()
  const portrait = withExifOrientation(sampleJpeg(), 6)
  const corners = async (options: Partial<PrintOptions>) =>
    (await print(server, [landscape, portrait], { ...options, items: items(1, 1) })).map(sheet => sheet.items.map(item => item.corners))

  assert.deepEqual(await corners({ printSize: { kind: "fit" } }), [
    [[[0, 24.09], [0, 817.8], [595.28, 24.09], [595.28, 817.8]]],
    [[[0, 24.09], [0, 817.8], [595.28, 24.09], [595.28, 817.8]]],
  ])
  assert.deepEqual(await corners({ printSize: { kind: "fill" } }), [
    [[[-18.07, 0], [-18.07, 841.89], [613.35, 0], [613.35, 841.89]]],
    [[[-18.07, 0], [-18.07, 841.89], [613.35, 0], [613.35, 841.89]]],
  ])
  // at a percentage nothing turns on its own
  assert.deepEqual(await corners(actualSize), [
    [[[0, 7.2], [9.6, 7.2], [0, 0], [9.6, 0]]],
    [[[0, 0], [0, 9.6], [7.2, 0], [7.2, 9.6]]],
  ])
})

test("each photo turns by its item's turn", async t => {
  const server = await start(t)

  const sheets = await print(server, [sampleJpeg(), samplePng(64, 48), samplePng(20, 10)], {
    ...actualSize, items: [{ count: 1, turn: 0 }, { count: 1, turn: 90 }, { count: 1, turn: 180 }],
  })

  assert.deepEqual(sheets.map(sheet => sheet.items.map(item => item.corners)), [
    [[[0, 7.2], [9.6, 7.2], [0, 0], [9.6, 0]]],
    [[[0, 0], [0, 15.36], [11.52, 0], [11.52, 15.36]]],
    [[[4.8, 0], [0, 0], [4.8, 2.4], [0, 2.4]]],
  ])
})

test("Print Options that don't fit the draft's files are refused and nothing is printed", async t => {
  const server = await start(t)
  const draft = async (files: Uint8Array<ArrayBuffer>[]) => {
    const { draftId } = await (await server.post("/api/drafts")).json() as { draftId: string }
    for (const file of files) await server.upload(draftId, file, "file")
    return draftId
  }
  const pdf = await draft([pdfWithPages([{ size: [200, 100] }, { size: [300, 100] }])])
  const photos = await draft([sampleJpeg(), samplePng(64, 48)])

  const refused: [draftId: string, options: Partial<PrintOptions>][] = [
    [pdf, { items: items(0, 0) }],
    [pdf, { items: items(1) }],
    [pdf, { items: items(1, 1, 1) }],
    [photos, { items: items(0, 0) }],
    [photos, { items: items(1) }],
    [photos, { items: items(1, 1, 1) }],
    [photos, { items: items(1, 1), layout: { kind: "grid", perSheet: 2 } }],
  ]
  for (const [draftId, options] of refused) {
    const submitted = await server.submit(draftId, options)
    assert.equal(submitted.status, 400, JSON.stringify(options))
    assert.deepEqual(await submitted.json(), { error: "invalid-options" })
  }
  assert.equal(server.printer.requests.length, 0)

  // the same drafts print once the options fit
  assert.equal((await server.submit(pdf, { items: items(0, 1), layout: { kind: "grid", perSheet: 2 } })).status, 201)
  assert.equal((await server.submit(photos, { items: items(1, 1) })).status, 201)
})

/** The form fields and annotations drawn into the one item of each sheet. */
const annotations = (sheets: Awaited<ReturnType<typeof printPdf>>) => sheets.map(sheet => sheet.items.map(item => item.annotations))

test("a filled form prints with what was filled in", async t => {
  const server = await start(t)
  const name = "/Tx BMC BT 2 6 Td (Anna) Tj ET EMC"
  const tick = "2 2 6 6 re f"
  const page: PdfPageSpec = {
    size: [200, 100],
    annotations: [
      { entries: "/Subtype /Widget /FT /Tx /T (Name) /V (Anna) /Rect [20 60 120 80] /F 4", appearance: { bbox: [0, 0, 100, 20], content: name } },
      {
        entries: "/Subtype /Widget /FT /Btn /T (Ja) /V /Yes /AS /Yes /Rect [20 30 30 40] /F 4",
        appearance: { Yes: { bbox: [0, 0, 10, 10], content: tick }, Off: { bbox: [0, 0, 10, 10], content: "" } },
      },
      {
        entries: "/Subtype /Widget /FT /Btn /T (Nein) /V /Off /AS /Off /Rect [40 30 50 40] /F 4",
        appearance: { Yes: { bbox: [0, 0, 10, 10], content: tick }, Off: { bbox: [0, 0, 10, 10], content: "" } },
      },
    ],
  }

  const sheets = await printPdf(server, [page], actualSize)

  assert.deepEqual(annotations(sheets), [[[
    { rect: [20, 60, 120, 80], content: name },
    { rect: [20, 30, 30, 40], content: tick },
    { rect: [40, 30, 50, 40], content: "" },
  ]]])
})

test("an annotation prints with its appearance, fitted to its rectangle on the page", async t => {
  const server = await start(t)
  const stamp = "1 0 0 rg 0 0 200 100 re f"
  const highlight = "1 1 0 rg 0 0 40 20 re f"
  const pages: PdfPageSpec[] = [
    {
      size: [200, 100],
      annotations: [
        // an appearance twice the size of its rectangle
        { entries: "/Subtype /Stamp /Rect [50 20 150 70] /F 4", appearance: { bbox: [0, 0, 200, 100], content: stamp } },
        // an appearance that lies on its side, and a rectangle given from its top-right corner
        { entries: "/Subtype /Highlight /QuadPoints [10 50 30 50 10 10 30 10] /Rect [30 50 10 10] /F 4", appearance: { bbox: [0, 0, 40, 20], matrix: [0, 1, -1, 0, 0, 0], content: highlight } },
      ],
    },
    // the annotations turn and move with their page
    { size: [200, 100], rotate: 90, cropBox: [40, 10, 160, 90], annotations: [{ entries: "/Subtype /Stamp /Rect [50 20 150 70] /F 4", appearance: { bbox: [0, 0, 200, 100], content: stamp } }] },
  ]

  const sheets = await printPdf(server, pages, { ...actualSize, items: items(1, 1) })

  assert.deepEqual(annotations(sheets), [
    [[{ rect: [50, 20, 150, 70], content: stamp }, { rect: [10, 10, 30, 50], content: highlight }]],
    [[{ rect: [50, 20, 150, 70], content: stamp }]],
  ])
  assert.deepEqual(sheets[1]!.items.map(({ size, box }) => ({ size, box })), [{ size: [120, 80], box: { left: 0, top: 0, width: 80, height: 120 } }])
})

test("an annotation that is hidden or not meant for printing is left out, and so is one without an appearance", async t => {
  const server = await start(t)
  const appearance = (content: string) => ({ bbox: [0, 0, 10, 10] as [number, number, number, number], content })
  const page: PdfPageSpec = {
    size: [200, 100],
    annotations: [
      { entries: "/Subtype /Stamp /Rect [0 0 10 10] /F 4", appearance: appearance("% printed") },
      // not shown on the screen, but printed
      { entries: "/Subtype /Stamp /Rect [10 0 20 10] /F 36", appearance: appearance("% printed, not shown") },
      { entries: "/Subtype /Stamp /Rect [20 0 30 10] /F 6", appearance: appearance("% hidden") },
      { entries: "/Subtype /Stamp /Rect [30 0 40 10] /F 5", appearance: appearance("% invisible") },
      { entries: "/Subtype /Stamp /Rect [40 0 50 10] /F 0", appearance: appearance("% screen only") },
      { entries: "/Subtype /Stamp /Rect [50 0 60 10]", appearance: appearance("% no flags") },
      { entries: "/Subtype /Link /Rect [60 0 70 10] /F 4" },
      // an appearance per state, and no state chosen
      { entries: "/Subtype /Widget /FT /Btn /T (Ja) /Rect [70 0 80 10] /F 4", appearance: { Yes: appearance("% no state") } },
      // a highlight that doesn't say which text it marks: pdf.js doesn't draw it
      { entries: "/Subtype /Highlight /Rect [80 0 90 10] /F 4", appearance: appearance("% marks nothing") },
      { entries: "/Subtype /Underline /QuadPoints [80 10 90 10 80 0] /Rect [80 0 90 10] /F 4", appearance: appearance("% marks half a stretch") },
    ],
  }

  const sheets = await printPdf(server, [page], actualSize)

  assert.deepEqual(annotations(sheets), [[[
    { rect: [0, 0, 10, 10], content: "% printed" },
    { rect: [10, 0, 20, 10], content: "% printed, not shown" },
  ]]])
})

test("a page with nothing on it but an annotation is printed", async t => {
  const server = await start(t)
  const stamp = "1 0 0 rg 0 0 100 50 re f"
  const page: PdfPageSpec = { size: [200, 100], blank: true, annotations: [{ entries: "/Subtype /Stamp /Rect [50 20 150 70] /F 4", appearance: { bbox: [0, 0, 100, 50], content: stamp } }] }

  const sheets = await printPdf(server, [page], actualSize)

  assert.deepEqual(sheets.map(sheet => sheet.items.map(({ size, annotations }) => ({ size, annotations }))), [
    [{ size: [200, 100], annotations: [{ rect: [50, 20, 150, 70], content: stamp }] }],
  ])
})

test("a filled text field that leaves its looks to the reader prints with its value", async t => {
  const server = await start(t)
  const written = (text: string) => new RegExp(`<${Buffer.from(text).toString("hex")}> Tj`, "i")
  const field = (value: string) => `/Subtype /Widget /FT /Tx /T (Name) /V (${value}) /Rect [20 60 120 80] /F 4`

  // a field without an appearance
  const bare = await printPdf(server, [{ size: [200, 100], annotations: [{ entries: field("Anna") }] }], actualSize)
  // a form that tells the reader to draw the values itself: the stored appearance is out of date
  const stale = await print(server, [pdfWithPages(
    [{ size: [200, 100], annotations: [{ entries: field("Berta"), appearance: { bbox: [0, 0, 100, 20], content: "BT (Anna) Tj ET" } }] }],
    { needAppearances: true },
  )], actualSize)

  for (const [sheets, value] of [[bare, "Anna"], [stale, "Berta"]] as const) {
    const drawn = annotations(sheets)[0]![0]!
    assert.deepEqual(drawn.map(annotation => annotation.rect), [[20, 60, 120, 80]], value)
    assert.match(drawn[0]!.content, written(value))
  }
})
