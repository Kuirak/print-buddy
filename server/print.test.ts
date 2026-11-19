import assert from "node:assert/strict"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"
import { Op, Tag, values } from "./printer/ipp-codec.ts"
import { samplePdf } from "./testing/fixtures.ts"
import { startTestServer } from "./testing/harness.ts"
import { readRenderedPdf } from "./testing/rendered-pdf.ts"

test("a picked PDF reaches the Printer as one Print Job", async t => {
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
  const sheets = await readRenderedPdf(request.data)
  assert.deepEqual(sheets.map(sheet => sheet.items.map(item => item.size)), [[[595, 842]]])
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

test("when CUPS can't be reached, submitting fails and the draft can be sent again", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const pdf = samplePdf()
  const { draftId } = await (await server.post("/api/drafts")).json() as { draftId: string }
  await server.upload(draftId, pdf, "a.pdf", "application/pdf")

  server.printer.printer.unreachable = true
  const failed = await server.submit(draftId)

  assert.equal(failed.status, 502)
  assert.deepEqual(await failed.json(), { error: "cups-unreachable" })

  server.printer.printer.unreachable = false
  const again = await server.submit(draftId, { copies: 3 })

  assert.equal(again.status, 201)
  const prints = server.printer.requests.filter(request => request.code === Op.printJob)
  assert.equal(prints.length, 1)
  assert.deepEqual((await readRenderedPdf(prints[0]!.data)).map(sheet => sheet.items.map(item => item.size)), [[[595, 842]]])
  assert.deepEqual(values(prints[0]!, Tag.job, "copies"), [3])
})

test("when CUPS rejects the job, submitting fails and no Print Job exists", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const { draftId } = await (await server.post("/api/drafts")).json() as { draftId: string }
  await server.upload(draftId, samplePdf(), "a.pdf", "application/pdf")

  server.printer.printer.acceptingJobs = false
  const rejected = await server.submit(draftId)

  assert.equal(rejected.status, 502)
  assert.deepEqual(await rejected.json(), { error: "cups-rejected" })
  assert.equal(server.printer.jobs.size, 0)

  // CUPS can also refuse below IPP, with a bare HTTP status
  server.printer.printer.acceptingJobs = true
  server.printer.printer.failNext = 503
  const refused = await server.submit(draftId)

  assert.equal(refused.status, 502)
  assert.deepEqual(await refused.json(), { error: "cups-rejected" })
  assert.equal(server.printer.jobs.size, 0)
})

test("when the draft's file can't be turned into a PDF, submitting fails and nothing reaches CUPS", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const { draftId } = await (await server.post("/api/drafts")).json() as { draftId: string }
  await server.upload(draftId, samplePdf(), "a.pdf", "application/pdf")

  // the file is gone from the disk, as after a cleanup that came too early
  await rm(join(server.jobsDir, "drafts", draftId, "1.pdf"))
  const failed = await server.submit(draftId)

  assert.equal(failed.status, 500)
  assert.deepEqual(await failed.json(), { error: "render-failed" })
  assert.equal(server.printer.requests.length, 0)
})
