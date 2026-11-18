import assert from "node:assert/strict"
import { test } from "node:test"
import { PDFDocument } from "@cantoo/pdf-lib"
import type { JobStatus } from "../shared/api.ts"
import { JobState } from "./printer/ipp-codec.ts"
import { samplePdf } from "./testing/fixtures.ts"
import { startTestServer, type TestServer } from "./testing/harness.ts"

/** Sends the sample PDF as a Print Job, the way the app does. */
async function printSample(server: TestServer) {
  const { draftId } = await (await server.post("/api/drafts")).json() as { draftId: string }
  await server.upload(draftId, samplePdf(), "a.pdf", "application/pdf")
  return await (await server.post(`/api/drafts/${draftId}/submit`)).json() as { jobId: string; cupsJobId: number }
}

const readJob = async (server: TestServer, jobId: string) =>
  await (await server.request(`/api/jobs/${jobId}`)).json() as JobStatus

test("a Print Job that CUPS just accepted reads as Wartet, with its job number, send time and sheet count", async t => {
  const sentAt = Date.UTC(2026, 10, 19, 8, 30, 0)
  const server = await startTestServer({ now: sentAt })
  t.after(server.close)
  const { jobId } = await printSample(server)
  server.clock.advance(5_000)

  const res = await server.request(`/api/jobs/${jobId}`)

  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), {
    jobId,
    state: "waiting",
    reason: null,
    details: { jobState: "pending", jobStateReasons: ["none"], printerMessage: "" },
    cupsJobId: 1,
    sentAt,
    endedAt: null,
    sheets: 1,
  })
})

test("the screen state follows the CUPS job state", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const { jobId, cupsJobId } = await printSample(server)

  const cases = [
    { cups: [JobState.pending, ["none"], ""], state: "waiting" },
    { cups: [JobState.held, ["job-hold-until-specified"], ""], state: "waiting" },
    { cups: [JobState.held, ["resources-are-not-ready"], "Job held for 30 seconds since it could not be sent."], state: "waiting" },
    { cups: [JobState.stopped, ["job-stopped"], ""], state: "waiting" },
    { cups: [JobState.processing, ["job-printing"], ""], state: "printing" },
    { cups: [JobState.processing, ["job-printing"], "Connected to printer."], state: "printing" },
    { cups: [JobState.processing, ["job-printing"], "Waiting for printer to finish."], state: "printing" },
  ] as const
  for (const { cups, state } of cases) {
    server.printer.setJob(cupsJobId, cups[0], [...cups[1]], cups[2])
    const status = await readJob(server, jobId)
    assert.equal(status.state, state, JSON.stringify(cups))
    assert.equal(status.reason, null, JSON.stringify(cups))
    assert.equal(status.endedAt, null, JSON.stringify(cups))
  }
})

test("a job that CUPS is processing but can't hand to the Printer yet still reads as Wartet", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const { jobId, cupsJobId } = await printSample(server)

  // the socket backend keeps an unreachable Printer's job in `processing`; only the message tells
  for (const message of [
    "Connecting to printer.",
    "The printer is not responding.",
    "The printer may not exist or is unavailable at this time.",
    "The printer is unreachable at this time.",
    "The printer is in use.",
  ]) {
    server.printer.setJob(cupsJobId, JobState.processing, ["job-printing"], message)
    const status = await readJob(server, jobId)
    assert.equal(status.state, "waiting", message)
    assert.deepEqual(status.details, { jobState: "processing", jobStateReasons: ["job-printing"], printerMessage: message })
  }
})

test("a completed job reads as Fertig, and remembers when Print Buddy saw it end", async t => {
  const sentAt = Date.UTC(2026, 10, 19, 8, 30, 0)
  const server = await startTestServer({ now: sentAt })
  t.after(server.close)
  const { jobId, cupsJobId } = await printSample(server)

  server.clock.advance(75_000)
  server.printer.setJob(cupsJobId, JobState.completed, ["job-completed-successfully"], "Print file sent.")
  const first = await readJob(server, jobId)
  server.clock.advance(60_000)
  const asked = server.printer.requests.length
  const later = await readJob(server, jobId)

  assert.equal(first.state, "done")
  assert.equal(first.reason, null)
  assert.equal(first.endedAt, sentAt + 75_000)
  assert.deepEqual(first.details, { jobState: "completed", jobStateReasons: ["job-completed-successfully"], printerMessage: "Print file sent." })
  assert.deepEqual(later, first)
  assert.equal(server.printer.requests.length, asked, "an ended job no longer changes, so CUPS is not asked again")
})

test("a job that CUPS aborted reads as Fehler", async t => {
  const sentAt = Date.UTC(2026, 10, 19, 8, 30, 0)
  const server = await startTestServer({ now: sentAt })
  t.after(server.close)
  const { jobId, cupsJobId } = await printSample(server)

  server.clock.advance(9_000)
  server.printer.setJob(cupsJobId, JobState.aborted, ["aborted-by-system"], "Job aborted after 5 unsuccessful attempts.")
  const status = await readJob(server, jobId)

  assert.equal(status.state, "error")
  assert.equal(status.reason, "Beim Drucken ist ein Fehler aufgetreten.")
  assert.equal(status.endedAt, sentAt + 9_000)
  assert.deepEqual(status.details, {
    jobState: "aborted",
    jobStateReasons: ["aborted-by-system"],
    printerMessage: "Job aborted after 5 unsuccessful attempts.",
  })
})

test("a job that someone else cancelled reads as Fehler", async t => {
  const sentAt = Date.UTC(2026, 10, 19, 8, 30, 0)
  const server = await startTestServer({ now: sentAt })
  t.after(server.close)
  const { jobId, cupsJobId } = await printSample(server)

  // CUPS marks every cancelled job like this, whoever cancelled it
  server.clock.advance(4_000)
  server.printer.setJob(cupsJobId, JobState.canceled, ["job-canceled-by-user"])
  const status = await readJob(server, jobId)

  assert.equal(status.state, "error")
  assert.equal(status.reason, "Der Auftrag wurde von jemand anderem abgebrochen.")
  assert.equal(status.endedAt, sentAt + 4_000)
})

test("a Print Job that does not exist is a 404", async t => {
  const server = await startTestServer()
  t.after(server.close)

  const res = await server.request("/api/jobs/no-such-job")

  assert.equal(res.status, 404)
  assert.deepEqual(await res.json(), { error: "not-found" })
  assert.equal(server.printer.requests.length, 0)
})

test("the sheet count is the number of pages sent to the Printer", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const pdf = await PDFDocument.create()
  for (let i = 0; i < 3; i++) pdf.addPage([595, 842])
  const { draftId } = await (await server.post("/api/drafts")).json() as { draftId: string }
  await server.upload(draftId, new Uint8Array(await pdf.save()), "a.pdf", "application/pdf")
  const { jobId } = await (await server.post(`/api/drafts/${draftId}/submit`)).json() as { jobId: string }

  assert.equal((await readJob(server, jobId)).sheets, 3)
})

test("while CUPS can't be reached, a Print Job reads as it was last seen", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const { jobId, cupsJobId } = await printSample(server)
  server.printer.setJob(cupsJobId, JobState.processing, ["job-printing"], "Connected to printer.")
  const seen = await readJob(server, jobId)

  server.printer.printer.failNext = 503
  const res = await server.request(`/api/jobs/${jobId}`)

  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), seen)
})
