import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"
import type { JobStatus } from "../shared/api.ts"
import { PrinterState, Tag, values } from "./printer/ipp-codec.ts"
import { pdfWithPages, sampleJpeg, samplePdf, samplePng, samplePrintOptions } from "./testing/fixtures.ts"
import { startTestServer } from "./testing/harness.ts"

test("the server's part of a report is the Print Buddy version of the add-on config and the Printer's state", async t => {
  const server = await startTestServer()
  t.after(server.close)
  server.printer.printer.state = PrinterState.stopped
  server.printer.printer.reasons = ["paused"]
  server.printer.printer.message = "Printer is paused"

  const res = await server.request("/api/report")

  const config = await readFile(join(import.meta.dirname, "..", "print-buddy", "config.yaml"), "utf8")
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), {
    version: /^version: "(.+)"$/m.exec(config)?.[1],
    printer: { state: "stopped", reasons: ["paused"], message: "Printer is paused" },
  })
})

test("the server's part of a report says so when CUPS doesn't answer", async t => {
  const server = await startTestServer()
  t.after(server.close)
  server.printer.printer.unreachable = true

  const { version, printer } = await (await server.request("/api/report")).json()

  assert.match(version, /^\d{4}\.\d{2}\.\d+$/)
  assert.deepEqual(printer, { state: "unknown", reasons: [], message: "" })
})

test("a Print Job reads back with its file type, size and page count and its Print Options, for the report", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const pdf = pdfWithPages([{ size: [595, 842] }, { size: [595, 842] }, { size: [420, 595] }])
  const { draftId } = await (await server.post("/api/drafts")).json() as { draftId: string }
  await server.upload(draftId, pdf, "Rechnung.pdf", "application/pdf")
  const { jobId } = await (await server.submit(draftId, { copies: 2, selection: [1, 3] })).json() as { jobId: string }

  const status = await (await server.request(`/api/jobs/${jobId}`)).json() as JobStatus

  assert.deepEqual(status.file, { kind: "pdf", bytes: pdf.length, count: 3 })
  assert.deepEqual(status.options, { ...samplePrintOptions, copies: 2, selection: [1, 3] })
})

test("a Print Job of photos reads back with their number and the size of all of them", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const [jpeg, png] = [sampleJpeg(), samplePng(20, 10)]

  const { jobId } = await server.print({ selection: [0] }, [jpeg, png])

  const status = await (await server.request(`/api/jobs/${jobId}`)).json() as JobStatus
  assert.deepEqual(status.file, { kind: "photo", bytes: jpeg.length + png.length, count: 2 })
})

test("nothing about who printed reaches CUPS, the job folder or the log", async t => {
  const logged: unknown[] = []
  for (const method of ["log", "info", "warn", "error"] as const) {
    t.mock.method(console, method, (...args: unknown[]) => { logged.push(...args) })
  }
  const server = await startTestServer()
  t.after(server.close)
  // what Cloudflare Access adds to every request it lets through
  const whoPrinted = { "Cf-Access-Authenticated-User-Email": "anna@example.org", Cookie: "CF_Authorization=anna-token" }
  const { draftId } = await (await server.request("/api/drafts", { method: "POST", headers: whoPrinted })).json() as { draftId: string }
  const form = new FormData()
  form.set("file", new File([samplePdf()], "Brief von Anna.pdf", { type: "application/pdf" }))
  await server.request(`/api/drafts/${draftId}/files`, { method: "POST", headers: whoPrinted, body: form })
  const submitted = await server.request(`/api/drafts/${draftId}/submit`, {
    method: "POST",
    headers: { ...whoPrinted, "content-type": "application/json" },
    body: JSON.stringify(samplePrintOptions),
  })
  const { jobId } = await submitted.json() as { jobId: string }
  // a failed read of the job is what the server logs most
  server.printer.printer.failNext = 503
  const status = await server.request(`/api/jobs/${jobId}`, { headers: whoPrinted })
  const report = await server.request("/api/report", { headers: whoPrinted })

  const anna = /anna|example\.org/i
  const [folder] = (await readdir(server.jobsDir)).filter(name => name.endsWith(jobId))
  const kept = await readdir(join(server.jobsDir, folder!))
  assert.doesNotMatch(kept.join() + await readFile(join(server.jobsDir, folder!, "job.json"), "utf8"), anna)
  assert.doesNotMatch(await status.text() + await report.text(), anna)
  assert.doesNotMatch(logged.map(String).join("\n"), anna)
  assert.equal(server.printer.requests.length > 0, true)
  for (const request of server.printer.requests) {
    assert.deepEqual(values(request, Tag.operation, "requesting-user-name"), ["print-buddy"])
    assert.doesNotMatch(JSON.stringify(request.groups), anna)
  }
})
