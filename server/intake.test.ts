import assert from "node:assert/strict"
import { test } from "node:test"
import { pdfWithPages } from "./testing/fixtures.ts"
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
