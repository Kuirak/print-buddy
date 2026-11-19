import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import { request } from "node:http"
import { join } from "node:path"
import { test } from "node:test"
import { docxHeader, encryptedPdf, heicHeader, pdfWithPages, sampleJpeg, samplePdf, samplePng, withExifOrientation } from "./testing/fixtures.ts"
import { startTestServer, type TestServer } from "./testing/harness.ts"

async function newDraft(server: TestServer): Promise<string> {
  const { draftId } = await (await server.post("/api/drafts")).json() as { draftId: string }
  return draftId
}

test("a PDF returns its page count and the page sizes a reader shows", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const pdf = pdfWithPages([
    { size: [595, 842] },
    { size: [300, 400], rotate: 90 },
    { size: [200, 100], cropBox: [10, 10, 110, 60] },
    { size: [842, 595], rotate: 270, cropBox: [0, 0, 800, 500] },
    { size: [300, 400], rotate: 180 },
  ])

  const added = await server.upload(await newDraft(server), pdf, "Rechnung.pdf", "application/pdf")

  assert.equal(added.status, 201)
  assert.deepEqual(await added.json(), {
    kind: "pdf",
    pageCount: 5,
    pages: [
      { width: 595, height: 842 },
      { width: 400, height: 300 },
      { width: 100, height: 50 },
      { width: 500, height: 800 },
      { width: 300, height: 400 },
    ],
  })
})

test("a page's size is that of the part a reader shows: the CropBox only as far as it lies on the page, turned by quarter turns only", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const pdf = pdfWithPages([
    // a CropBox that reaches beyond the page
    { size: [200, 100], cropBox: [-50, -20, 150, 300] },
    // one given from its top-right corner
    { size: [200, 100], cropBox: [150, 60, 20, 10] },
    // one that misses the page: a reader shows the whole page
    { size: [200, 100], cropBox: [300, 300, 400, 400] },
    { size: [200, 100], cropBox: [-50, 0, 150, 100], rotate: 90 },
    // a reader doesn't turn a page by 45°, and takes 450° for 90°
    { size: [200, 100], rotate: 45 },
    { size: [200, 100], rotate: 450 },
  ])

  const added = await server.upload(await newDraft(server), pdf, "Plan.pdf", "application/pdf")

  assert.deepEqual((await added.json() as { pages: unknown }).pages, [
    { width: 150, height: 100 },
    { width: 130, height: 50 },
    { width: 200, height: 100 },
    { width: 100, height: 150 },
    { width: 200, height: 100 },
    { width: 100, height: 200 },
  ])
})

test("a photo returns its pixel size and EXIF orientation", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const draftId = await newDraft(server)

  const plain = await server.upload(draftId, sampleJpeg(), "IMG_1.jpg", "image/jpeg")
  const sideways = await server.upload(draftId, withExifOrientation(sampleJpeg(), 6), "IMG_2.jpg", "image/jpeg")
  const png = await server.upload(draftId, samplePng(64, 48), "Scan.png", "image/png")

  assert.equal(plain.status, 201)
  assert.deepEqual(await plain.json(), { kind: "photo", format: "jpeg", width: 40, height: 30, orientation: 1 })
  // the pixel size is the stored one: orientation 6 is not applied to it
  assert.deepEqual(await sideways.json(), { kind: "photo", format: "jpeg", width: 40, height: 30, orientation: 6 })
  assert.deepEqual(await png.json(), { kind: "photo", format: "png", width: 64, height: 48, orientation: 1 })
})

test("the type comes from the content: a PDF named .jpg is a PDF, a photo named .pdf is a photo", async t => {
  const server = await startTestServer()
  t.after(server.close)

  const pdf = await server.upload(await newDraft(server), samplePdf(), "Urlaub.jpg", "image/jpeg")
  const photo = await server.upload(await newDraft(server), sampleJpeg(), "Rechnung.pdf", "application/pdf")

  assert.equal(pdf.status, 201)
  assert.equal((await pdf.json() as { kind: string }).kind, "pdf")
  assert.equal(photo.status, 201)
  assert.equal((await photo.json() as { kind: string }).kind, "photo")
})

test("files Print Buddy can't print are refused as unsupported-type", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const unreadable: Record<string, Uint8Array<ArrayBuffer>> = {
    "an iPhone HEIC photo, even when it is named .jpg": heicHeader(),
    "a Word document": docxHeader(),
    "plain text": new Uint8Array(Buffer.from("Hallo")),
    "an empty file": new Uint8Array(),
    "a file that only starts like a PDF": new Uint8Array(Buffer.from("%PDF-1.4 nonsense")),
    "a PDF that needs a password to open": await encryptedPdf({ userPassword: "geheim", ownerPassword: "owner" }),
    "a file that only starts like a JPEG": new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]),
    "a file that only starts like a PNG": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  }

  for (const [what, bytes] of Object.entries(unreadable)) {
    const draftId = await newDraft(server)
    const added = await server.upload(draftId, bytes, "IMG_1.jpg", "image/jpeg")

    assert.equal(added.status, 415, what)
    assert.deepEqual(await added.json(), { refusal: "unsupported-type" }, what)
    // the draft is still empty: a file that can be printed is accepted afterwards
    assert.equal((await server.upload(draftId, samplePdf(), "a.pdf")).status, 201, what)
  }
})

test("a PDF that is only protected against editing opens without a password and is accepted", async t => {
  const server = await startTestServer()
  t.after(server.close)

  const added = await server.upload(await newDraft(server), await encryptedPdf({ userPassword: "", ownerPassword: "owner" }), "a.pdf")

  assert.equal(added.status, 201)
  assert.deepEqual(await added.json(), { kind: "pdf", pageCount: 1, pages: [{ width: 100, height: 100 }] })
})

test("a second PDF in a draft is refused as one-pdf-only", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const draftId = await newDraft(server)
  await server.upload(draftId, samplePdf(), "a.pdf")

  const second = await server.upload(draftId, samplePdf(), "b.pdf")

  assert.equal(second.status, 409)
  assert.deepEqual(await second.json(), { refusal: "one-pdf-only" })
})

test("a PDF added to photos, or a photo added to a PDF, is refused as mixed-types", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const photos = await newDraft(server)
  await server.upload(photos, sampleJpeg(), "a.jpg")
  const pdf = await newDraft(server)
  await server.upload(pdf, samplePdf(), "a.pdf")

  const pdfToPhotos = await server.upload(photos, samplePdf(), "b.pdf")
  const photoToPdf = await server.upload(pdf, samplePng(4, 4), "b.png")

  assert.equal(pdfToPhotos.status, 409)
  assert.deepEqual(await pdfToPhotos.json(), { refusal: "mixed-types" })
  assert.equal(photoToPdf.status, 409)
  assert.deepEqual(await photoToPdf.json(), { refusal: "mixed-types" })
})

test("20 photos are accepted and the 21st is refused as too-many-photos", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const draftId = await newDraft(server)

  for (let n = 1; n <= 20; n++) {
    const added = await server.upload(draftId, n % 2 ? sampleJpeg() : samplePng(4, 4), `IMG_${n}`)
    assert.equal(added.status, 201, `photo ${n}`)
  }
  const extra = await server.upload(draftId, sampleJpeg(), "IMG_21.jpg")

  assert.equal(extra.status, 409)
  assert.deepEqual(await extra.json(), { refusal: "too-many-photos" })
})

test("a refused file is not kept, and the accepted ones stay on disk in upload order", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const draftId = await newDraft(server)
  const first = withExifOrientation(sampleJpeg(), 3)
  const second = samplePng(8, 6)

  await server.upload(draftId, first, "b.jpg")
  await server.upload(draftId, samplePdf(), "refused.pdf")
  await server.upload(draftId, heicHeader(), "refused.heic")
  await server.upload(draftId, second, "a.png")

  const dir = join(server.jobsDir, "drafts", draftId)
  assert.deepEqual((await readdir(dir)).sort(), ["1.jpg", "2.png"])
  assert.deepEqual(await readFile(join(dir, "1.jpg")), Buffer.from(first))
  assert.deepEqual(await readFile(join(dir, "2.png")), Buffer.from(second))
})

/** A PDF padded with a trailing comment to exactly `size` bytes. */
function pdfOfSize(size: number): Uint8Array<ArrayBuffer> {
  const pdf = samplePdf()
  const padded = new Uint8Array(size).fill(0x20)
  padded.set(pdf)
  padded[pdf.length] = 0x25 // "%"
  return padded
}

test("a file of exactly upload_limit_mb is accepted and one byte more is refused as too-large", async t => {
  const server = await startTestServer({ options: { upload_limit_mb: 1 } })
  t.after(server.close)
  const draftId = await newDraft(server)

  const tooLarge = await server.upload(draftId, pdfOfSize(1024 * 1024 + 1), "gross.pdf")
  const atLimit = await server.upload(draftId, pdfOfSize(1024 * 1024), "passt.pdf")

  assert.equal(tooLarge.status, 413)
  assert.deepEqual(await tooLarge.json(), { refusal: "too-large", limitMb: 1 })
  assert.equal(atLimit.status, 201)
})

test("without upload_limit_mb the limit is 50 MB", async t => {
  const server = await startTestServer()
  t.after(server.close)

  const tooLarge = await server.upload(await newDraft(server), pdfOfSize(50 * 1024 * 1024 + 1), "gross.pdf")

  assert.equal(tooLarge.status, 413)
  assert.deepEqual(await tooLarge.json(), { refusal: "too-large", limitMb: 50 })
})

test("a file far over the limit is refused while it is still arriving", async t => {
  const server = await startTestServer({ options: { upload_limit_mb: 1 } })
  t.after(server.close)
  const draftId = await newDraft(server)
  const total = 40 * 1024 * 1024
  const chunk = Buffer.alloc(64 * 1024, 0x20)

  // a chunked upload without Content-Length, so the server can't know the size up front
  const answer = await new Promise<{ status: number; body: string; sent: number }>((resolve, reject) => {
    let sent = 0
    let answered = false
    const req = request(`${server.url}/api/drafts/${draftId}/files`, {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=grenze" },
    })
    req.on("response", res => {
      answered = true
      let body = ""
      res.setEncoding("utf8")
      res.on("data", (text: string) => { body += text })
      res.on("end", () => resolve({ status: res.statusCode!, body, sent }))
    })
    // the server may close the connection once it has answered
    req.on("error", err => { if (!answered) reject(err) })
    req.write('--grenze\r\ncontent-disposition: form-data; name="file"; filename="gross.pdf"\r\n\r\n%PDF-1.4\n')
    const pump = () => {
      if (answered) return
      if (sent >= total) return void req.end("\r\n--grenze--\r\n")
      sent += chunk.length
      req.write(chunk, () => setImmediate(pump))
    }
    pump()
  })

  assert.equal(answer.status, 413)
  assert.deepEqual(JSON.parse(answer.body), { refusal: "too-large", limitMb: 1 })
  assert.ok(answer.sent < total, `answered after ${answer.sent} of ${total} bytes`)
})
