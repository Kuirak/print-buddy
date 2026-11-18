import assert from "node:assert/strict"
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
