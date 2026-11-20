import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"
import type { SubmitProgress } from "../shared/api.ts"
import type { PrintOptions } from "../shared/print-options.ts"
import { ENGINE_FORMAT, GRID, type DellEngine } from "./dell-engine.ts"
import { Op, Tag, findAttr, values } from "./printer/ipp-codec.ts"
import { RASTERS } from "./printer/hbpl.ts"
import type { FakeIpp } from "./testing/fake-ipp.ts"
import { jpegWithPixels, pdfWithPages, pngWithPixels, withExifOrientation } from "./testing/fixtures.ts"
import { startTestServer, type TestServer } from "./testing/harness.ts"

/**
 * A Dell engine for tests, not Dell's. Every toner has a cell of 2 × 1 pixels whose quanta switch on in the order
 * left weak, right weak, left middle, right middle, left full, right full. The table gives 3 quanta of cyan
 * (left middle, right weak) to every colour but paper white, and nothing of the other toners.
 */
function testEngine(): DellEngine {
  const screen = { width: 2, rows: 1, shift: 0, order: [0, 3, 1, 4, 2, 5] }
  const table: number[][] = []
  for (let r = 0; r < GRID; r++) for (let g = 0; g < GRID; g++) for (let b = 0; b < GRID; b++) {
    const paper = r === GRID - 1 && g === GRID - 1 && b === GRID - 1
    table.push([paper ? 0 : 3, 0, 0, 0])
  }
  return {
    format: ENGINE_FORMAT, about: "test engine", driver: "test", imageType: "Standard", measured: "2026-11-19",
    screens: { C: screen, M: screen, Y: screen, K: screen }, table,
  }
}

/** Cyan left middle (code 10, high nibble) on even columns, right weak (code 01, low nibble) on odd ones. */
const cyanAt = (x: number) => (x % 2 === 0 ? 0x80 : 0x08)

/** A photo of 100 × 50 pixels, black on the left half and white on the right: at 300 ppi and 100 %, 200 × 100 dots. */
const halfBlack = () => pngWithPixels(Array.from({ length: 50 }, () => Array.from({ length: 100 }, (_, x) => (x < 50 ? [0, 0, 0] : [255, 255, 255]))))
const white = () => pngWithPixels(Array.from({ length: 50 }, () => Array.from({ length: 100 }, () => [255, 255, 255])))

const noMargins = (printer: FakeIpp) => {
  for (const media of printer.printer.media) Object.assign(media, { top: 0, right: 0, bottom: 0, left: 0 })
}

const colourPhotos: Partial<PrintOptions> = {
  color: "color", printSize: { kind: "percent", value: 100 }, position: "top-left", selection: [0],
}

async function start(t: { after(fn: () => unknown): void }) {
  const server = await startTestServer({ dellEngine: testEngine(), beforeStart: noMargins })
  t.after(server.close)
  return server
}

test("with Dell's engine in the share folder, a colour photo goes to CUPS as raw HBPL, toned by the engine's table and screens", async t => {
  const server = await start(t)

  await server.print(colourPhotos, [halfBlack()])

  const request = server.printer.requests.at(-1)!
  assert.deepEqual(values(request, Tag.operation, "document-format"), ["application/vnd.cups-raw"])
  // past the queue's driver: no PPD options, and the copies are in the data
  assert.equal(findAttr(request, Tag.job, "copies"), undefined)
  assert.equal(findAttr(request, Tag.job, "ColorMode"), undefined)
  const { width, height } = RASTERS.A4
  const raster = request.data
  assert.equal(raster.length, width * height)
  const at = (x: number, y: number) => raster[y * width + x]!
  // the black half, away from the edge the scaling blurs
  for (let y = 0; y < 100; y++) for (let x = 0; x < 90; x++) assert.equal(at(x, y), cyanAt(x), `dot ${x}, ${y}`)
  // the white half and everything off the photo: no toner
  for (let y = 0; y < 100; y++) for (let x = 110; x < 200; x++) assert.equal(at(x, y), 0, `dot ${x}, ${y}`)
  const inked = raster.reduce((count, byte, i) => count + (byte !== 0 && (i % width >= 200 || i / width >= 100) ? 1 : 0), 0)
  assert.equal(inked, 0)

  // the job folder keeps what CUPS got
  const [folder] = (await readdir(server.jobsDir)).filter(name => name !== "drafts")
  assert.deepEqual((await readdir(join(server.jobsDir, folder!))).sort(), ["job.json", "print.hbpl", "upload-1.png"])
  assert.ok(Buffer.from(raster).equals(await readFile(join(server.jobsDir, folder!, "print.hbpl"))), "print.hbpl holds what CUPS got")
})

test("the copies of a Dell job are in its data, collated: the sheets in order, then again", async t => {
  const server = await start(t)

  await server.print({ ...colourPhotos, paper: "A5", copies: 2, selection: [0, 1] }, [halfBlack(), white()])

  const request = server.printer.requests.at(-1)!
  const { width, height } = RASTERS.A5
  const sheet = width * height
  assert.equal(request.data.length, 4 * sheet)
  const inked = [0, 1, 2, 3].map(n => request.data.subarray(n * sheet, (n + 1) * sheet).some(byte => byte !== 0))
  assert.deepEqual(inked, [true, false, true, false])
})

test("a colour PDF goes to CUPS as raw HBPL too: its pages rasterised and toned by the engine, the sheets in order, then again", async t => {
  const server = await start(t)
  // the second page has a 10 pt square in its bottom left corner, which at 100 % and top left is the sheet's
  const page: [number, number] = [595, 842]

  await server.print({ ...colourPhotos, copies: 2, selection: [1, 2] }, [pdfWithPages([{ size: page, blank: true }, { size: page }])])

  const request = server.printer.requests.at(-1)!
  assert.deepEqual(values(request, Tag.operation, "document-format"), ["application/vnd.cups-raw"])
  const { width, height } = RASTERS.A4
  const sheet = width * height
  assert.equal(request.data.length, 4 * sheet)
  const inked = [0, 1, 2, 3].map(n => request.data.subarray(n * sheet, (n + 1) * sheet).some(byte => byte !== 0))
  assert.deepEqual(inked, [false, true, false, true])

  const second = request.data.subarray(sheet, 2 * sheet)
  const at = (x: number, y: number) => second[y * width + x]!
  // the square is 10 pt, 83 dots, up from the page's bottom edge, 842 pt down: it runs to the sheet's last full row,
  // as the sheet is 7015.75 dots high
  const top = Math.round((842 - 10) / (72 / 600))
  for (let y = top + 3; y < height - 1; y++) for (let x = 0; x < 80; x++) assert.equal(at(x, y), cyanAt(x), `dot ${x}, ${y}`)
  const outside = second.reduce((count, byte, i) => count + (byte !== 0 && (i % width >= 86 || i / width < top - 3) ? 1 : 0), 0)
  assert.equal(outside, 0)
})

test("black and white Print Jobs still go to the queue's driver as a PDF when Dell's engine is there", async t => {
  const server = await start(t)

  await server.print({ ...colourPhotos, color: "mono" }, [halfBlack()])
  await server.print({ color: "mono" }, [pdfWithPages([{ size: [595, 842] }])])

  const formats = server.printer.requests.filter(r => findAttr(r, Tag.operation, "document-format")).map(r => values(r, Tag.operation, "document-format")[0])
  assert.deepEqual(formats, ["application/pdf", "application/pdf"])
})

test("a colour photo comes out upright for its EXIF orientation", async t => {
  const server = await start(t)
  // the stored photo is black in its top-left quarter and white elsewhere, so every turn and mirroring moves the black
  const corner = await jpegWithPixels(Array.from({ length: 30 }, (_, y) => Array.from({ length: 40 }, (_, x) => (x < 20 && y < 15 ? [0, 0, 0] : [255, 255, 255]))))
  // where the black quarter belongs once the photo is upright, from the EXIF definition of each orientation, as [column, row]
  const upright: Record<number, [number, number]> = { 1: [0, 0], 2: [1, 0], 3: [1, 1], 4: [0, 1], 5: [0, 0], 6: [1, 0], 7: [1, 1], 8: [0, 1] }
  const { width } = RASTERS.A4

  for (const [orientation, [column, row]] of Object.entries(upright)) {
    await server.print(colourPhotos, [withExifOrientation(corner, Number(orientation))])

    // at 100 % the upright photo is 80 × 60 dots, or 60 × 80 when the orientation turns it
    const [w, h] = Number(orientation) >= 5 ? [60, 80] : [80, 60]
    const raster = server.printer.requests.at(-1)!.data
    const inked = [[0, 0], [0, 0]]
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (raster[y * width + x] !== 0) inked[y < h / 2 ? 0 : 1]![x < w / 2 ? 0 : 1]!++
    const total = inked.flat().reduce((sum, n) => sum + n, 0)
    const black = inked[row]![column]!
    assert.ok(black > 0.8 * (w * h) / 4 && black > 0.9 * total, `orientation ${orientation}: ${JSON.stringify(inked)}`)
  }
})

/** A draft with these files, not yet submitted. */
async function draftWith(server: TestServer, files: Uint8Array<ArrayBuffer>[]) {
  const { draftId } = await (await server.post("/api/drafts")).json() as { draftId: string }
  for (const file of files) assert.equal((await server.upload(draftId, file, "file")).status, 201)
  return draftId
}

const progressOf = async (server: TestServer, draftId: string) => {
  const res = await server.request(`/api/drafts/${draftId}/progress`)
  return res.status === 200 ? await res.json() as SubmitProgress : res.status
}

test("while a colour photo job is prepared its progress counts the finished sheets, and a stop ends it without a Print Job", async t => {
  const { width, height } = RASTERS.A5
  const firstSheetRead = Promise.withResolvers<void>()
  const gate = Promise.withResolvers<void>()
  let read = 0
  // foo2hbpl2 stand-in that stops reading after the first sheet until the test lets it go on
  const server = await startTestServer({
    dellEngine: testEngine(),
    beforeStart: noMargins,
    encodeHbpl: async (_paper, raster) => {
      const chunks: Uint8Array[] = []
      for await (const chunk of raster) {
        chunks.push(chunk)
        read += chunk.length
        if (read === width * height) {
          firstSheetRead.resolve()
          await gate.promise
        }
      }
      return Buffer.concat(chunks)
    },
  })
  t.after(server.close)
  const draftId = await draftWith(server, [halfBlack(), white()])

  const submitted = server.submit(draftId, { ...colourPhotos, paper: "A5", selection: [0, 1] })
  await firstSheetRead.promise

  assert.deepEqual(await progressOf(server, draftId), { phase: "preparing", sheetsDone: 1, sheets: 2 })
  assert.equal((await server.post(`/api/drafts/${draftId}/stop`)).status, 204)
  gate.resolve()
  const answer = await submitted
  assert.equal(answer.status, 409)
  assert.deepEqual(await answer.json(), { error: "stopped" })
  assert.equal(server.printer.jobs.size, 0)
  assert.equal(await progressOf(server, draftId), 404)
  // the draft is as it was, so the same submit can be sent again
  assert.equal((await server.submit(draftId, { ...colourPhotos, paper: "A5", selection: [0, 1] })).status, 201)
})

test("once CUPS is getting the job a submit can't be stopped, and a second submit of the draft is refused meanwhile", async t => {
  const server = await start(t)
  const draftId = await draftWith(server, [halfBlack()])
  const answer = server.printer.hold(Op.printJob)

  const submitted = server.submit(draftId, colourPhotos)
  await answer.arrived

  assert.deepEqual(await progressOf(server, draftId), { phase: "sending" })
  const stop = await server.post(`/api/drafts/${draftId}/stop`)
  assert.equal(stop.status, 409)
  assert.deepEqual(await stop.json(), { error: "not-stoppable" })
  const second = await server.submit(draftId, colourPhotos)
  assert.equal(second.status, 409)
  assert.deepEqual(await second.json(), { error: "already-submitting" })
  answer.release()
  assert.equal((await submitted).status, 201)
  assert.equal(server.printer.jobs.size, 1)
})
