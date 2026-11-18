import assert from "node:assert/strict"
import { test } from "node:test"
import { Op, Tag, values } from "./printer/ipp-codec.ts"
import { samplePdf } from "./testing/fixtures.ts"
import { startTestServer } from "./testing/harness.ts"

test("a picked PDF reaches the Printer unchanged as one Print Job", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const pdf = samplePdf()

  const created = await server.post("/api/drafts")
  assert.equal(created.status, 201)
  const { draftId } = await created.json() as { draftId: string }

  const added = await server.upload(draftId, pdf, "Rechnung.pdf", "application/pdf")
  assert.equal(added.status, 201)

  const submitted = await server.submit(draftId)
  assert.equal(submitted.status, 201)
  const job = await submitted.json() as { jobId: string; cupsJobId: number }
  assert.equal(typeof job.jobId, "string")
  assert.equal(job.cupsJobId, 1)

  assert.equal(server.printer.requests.length, 1)
  const request = server.printer.requests[0]!
  assert.equal(request.code, Op.printJob)
  assert.deepEqual(values(request, Tag.operation, "requesting-user-name"), ["print-buddy"])
  assert.deepEqual(values(request, Tag.operation, "printer-uri"), [server.printer.uri])
  assert.deepEqual(values(request, Tag.operation, "document-format"), ["application/pdf"])
  assert.deepEqual(Buffer.from(request.data), Buffer.from(pdf))
})

test("a draft that does not exist is a 404 and nothing is printed", async t => {
  const server = await startTestServer()
  t.after(server.close)

  const added = await server.upload("no-such-draft", samplePdf(), "a.pdf", "application/pdf")
  const submitted = await server.post("/api/drafts/no-such-draft/submit")

  assert.equal(added.status, 404)
  assert.equal(submitted.status, 404)
  assert.deepEqual(await submitted.json(), { error: "not-found" })
  assert.equal(server.printer.requests.length, 0)
})

test("a draft without a file cannot be submitted", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const { draftId } = await (await server.post("/api/drafts")).json() as { draftId: string }

  const submitted = await server.submit(draftId)

  assert.equal(submitted.status, 400)
  assert.deepEqual(await submitted.json(), { error: "empty-draft" })
  assert.equal(server.printer.requests.length, 0)
})
