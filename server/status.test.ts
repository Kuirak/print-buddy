import assert from "node:assert/strict"
import { test } from "node:test"
import type { JobStatus } from "../shared/api.ts"
import type { PrintOptions } from "../shared/print-options.ts"
import { JobState } from "./printer/ipp-codec.ts"
import { pdfWithPages, sampleJpeg, type PdfPageSpec } from "./testing/fixtures.ts"
import { startTestServer, type TestServer } from "./testing/harness.ts"
import { readRenderedPdf } from "./testing/rendered-pdf.ts"

const readJob = async (server: TestServer, jobId: string) =>
  await (await server.request(`/api/jobs/${jobId}`)).json() as JobStatus

test("a Print Job that CUPS just accepted reads as Wartet, with its job number, send time and sheet count", async t => {
  const sentAt = Date.UTC(2026, 10, 19, 8, 30, 0)
  const server = await startTestServer({ now: sentAt })
  t.after(server.close)
  const { jobId } = await server.print()
  server.clock.advance(5_000)

  const res = await server.request(`/api/jobs/${jobId}`)

  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), {
    jobId,
    state: "waiting",
    reason: null,
    details: { jobState: "pending", jobStateReasons: ["none"], printerStateReasons: ["none"], printerMessage: "" },
    cupsJobId: 1,
    sentAt,
    endedAt: null,
    sheets: 1,
  })
})

test("the screen state follows the CUPS job state", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const { jobId, cupsJobId } = await server.print()

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
  const { jobId, cupsJobId } = await server.print()

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
    assert.deepEqual(status.details, { jobState: "processing", jobStateReasons: ["job-printing"], printerStateReasons: ["none"], printerMessage: message })
  }
})

test("a completed job reads as Fertig, and remembers when Print Buddy saw it end", async t => {
  const sentAt = Date.UTC(2026, 10, 19, 8, 30, 0)
  const server = await startTestServer({ now: sentAt })
  t.after(server.close)
  const { jobId, cupsJobId } = await server.print()

  server.clock.advance(75_000)
  server.printer.setJob(cupsJobId, JobState.completed, ["job-completed-successfully"], "Print file sent.")
  const first = await readJob(server, jobId)
  server.clock.advance(60_000)
  const asked = server.printer.requests.length
  const later = await readJob(server, jobId)

  assert.equal(first.state, "done")
  assert.equal(first.reason, null)
  assert.equal(first.endedAt, sentAt + 75_000)
  assert.deepEqual(first.details, {
    jobState: "completed",
    jobStateReasons: ["job-completed-successfully"],
    printerStateReasons: ["none"],
    printerMessage: "Print file sent.",
  })
  assert.deepEqual(later, first)
  assert.equal(server.printer.requests.length, asked, "an ended job no longer changes, so CUPS is not asked again")
})

test("a job that CUPS aborted reads as Fehler", async t => {
  const sentAt = Date.UTC(2026, 10, 19, 8, 30, 0)
  const server = await startTestServer({ now: sentAt })
  t.after(server.close)
  const { jobId, cupsJobId } = await server.print()

  server.clock.advance(9_000)
  server.printer.setJob(cupsJobId, JobState.aborted, ["aborted-by-system"], "Job aborted after 5 unsuccessful attempts.")
  const status = await readJob(server, jobId)

  assert.equal(status.state, "error")
  assert.equal(status.reason, "Beim Drucken ist ein Fehler aufgetreten.")
  assert.equal(status.endedAt, sentAt + 9_000)
  assert.deepEqual(status.details, {
    jobState: "aborted",
    jobStateReasons: ["aborted-by-system"],
    printerStateReasons: ["none"],
    printerMessage: "Job aborted after 5 unsuccessful attempts.",
  })
})

test("a job that someone else cancelled reads as Fehler", async t => {
  const sentAt = Date.UTC(2026, 10, 19, 8, 30, 0)
  const server = await startTestServer({ now: sentAt })
  t.after(server.close)
  const { jobId, cupsJobId } = await server.print()

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

test("the sheet count is the number of sheets in the PDF the Printer received, for every copy", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const a4: PdfPageSpec = { size: [595, 842] }
  const pdf = [pdfWithPages([a4, a4, a4])]
  const photos = [sampleJpeg(), sampleJpeg()]

  const cases: { files: Uint8Array<ArrayBuffer>[]; options: Partial<PrintOptions>; rendered: number; sheets: number }[] = [
    { files: pdf, options: { selection: [1, 2, 3], copies: 2 }, rendered: 3, sheets: 6 },
    { files: pdf, options: { selection: [3, 1], copies: 2 }, rendered: 2, sheets: 4 },
    { files: pdf, options: { selection: [1, 2, 3], pagesPerSheet: 2, copies: 1 }, rendered: 2, sheets: 2 },
    { files: pdf, options: { selection: [1, 2, 3], pagesPerSheet: 2, copies: 5 }, rendered: 2, sheets: 10 },
    { files: photos, options: { selection: [0, 1], copies: 3 }, rendered: 2, sheets: 6 },
    { files: photos, options: { selection: [1], copies: 3 }, rendered: 1, sheets: 3 },
  ]
  for (const { files, options, rendered, sheets } of cases) {
    const { jobId } = await server.print(options, files)

    assert.equal((await readRenderedPdf(server.printer.requests.at(-1)!.data)).length, rendered, JSON.stringify(options))
    assert.equal((await readJob(server, jobId)).sheets, sheets, JSON.stringify(options))
  }
})

test("while CUPS can't be reached, a Print Job reads as it was last seen", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const { jobId, cupsJobId } = await server.print()
  server.printer.setJob(cupsJobId, JobState.processing, ["job-printing"], "Connected to printer.")
  const seen = await readJob(server, jobId)

  server.printer.printer.failNext = 503
  const res = await server.request(`/api/jobs/${jobId}`)

  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), seen)
})

test("a failed job tells the reason in German when CUPS names one Print Buddy knows", async t => {
  const server = await startTestServer()
  t.after(server.close)

  const cases = [
    { job: ["aborted-by-system"], printer: ["offline-report"], message: "", reason: "Der Drucker antwortet nicht. Ist er eingeschaltet?" },
    { job: ["aborted-by-system"], printer: ["none"], message: "The printer is not responding.", reason: "Der Drucker antwortet nicht. Ist er eingeschaltet?" },
    { job: ["aborted-by-system"], printer: ["connecting-to-device"], message: "", reason: "Verbindung zum Drucker wird aufgebaut." },
    { job: ["aborted-by-system"], printer: ["media-empty-warning"], message: "", reason: "Kein Papier im Drucker." },
    { job: ["aborted-by-system"], printer: ["media-empty-error"], message: "", reason: "Kein Papier im Drucker." },
    { job: ["aborted-by-system"], printer: ["media-needed"], message: "", reason: "Kein Papier im Drucker." },
    { job: ["aborted-by-system"], printer: ["media-jam-error"], message: "", reason: "Papierstau im Drucker." },
    { job: ["aborted-by-system"], printer: ["stopped"], message: "", reason: "Der Drucker ist in CUPS angehalten." },
    { job: ["aborted-by-system"], printer: ["paused"], message: "", reason: "Der Drucker ist in CUPS angehalten." },
    { job: ["printer-stopped"], printer: ["none"], message: "", reason: "Der Drucker ist in CUPS angehalten." },
    { job: ["aborted-by-system"], printer: ["toner-empty-error"], message: "", reason: "Toner ist leer." },
    { job: ["aborted-by-system"], printer: ["marker-supply-empty-warning"], message: "", reason: "Toner ist leer." },
    { job: ["aborted-by-system"], printer: ["cover-open"], message: "", reason: "Eine Klappe am Drucker ist offen." },
    { job: ["aborted-by-system"], printer: ["door-open-report"], message: "", reason: "Eine Klappe am Drucker ist offen." },
    // the first reason Print Buddy knows wins
    { job: ["aborted-by-system"], printer: ["cups-waiting-for-job-completed", "media-jam-error", "cover-open"], message: "", reason: "Papierstau im Drucker." },
  ]
  for (const { job, printer, message, reason } of cases) {
    const { jobId, cupsJobId } = await server.print()
    server.printer.setJob(cupsJobId, JobState.aborted, job, message, printer)

    const status = await readJob(server, jobId)

    assert.equal(status.state, "error", JSON.stringify({ job, printer }))
    assert.equal(status.reason, reason, JSON.stringify({ job, printer, message }))
    assert.deepEqual(status.details, { jobState: "aborted", jobStateReasons: job, printerStateReasons: printer, printerMessage: message })
  }
})

test("a failed job with a reason Print Buddy doesn't know gets a generic sentence, and what CUPS said as details", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const { jobId, cupsJobId } = await server.print()

  server.printer.setJob(cupsJobId, JobState.aborted, ["cups-filter-crashed"], "Filter failed", ["fuser-over-temp-error"])
  const status = await readJob(server, jobId)

  assert.equal(status.state, "error")
  assert.equal(status.reason, "Beim Drucken ist ein Fehler aufgetreten.")
  assert.equal(status.cupsJobId, cupsJobId)
  assert.deepEqual(status.details, {
    jobState: "aborted",
    jobStateReasons: ["cups-filter-crashed"],
    printerStateReasons: ["fuser-over-temp-error"],
    printerMessage: "Filter failed",
  })
})

test("a job someone else cancelled says so, whatever the Printer reports", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const { jobId, cupsJobId } = await server.print()

  server.printer.setJob(cupsJobId, JobState.canceled, ["job-canceled-by-user"], "", ["media-empty-warning"])
  const status = await readJob(server, jobId)

  assert.equal(status.state, "error")
  assert.equal(status.reason, "Der Auftrag wurde von jemand anderem abgebrochen.")
})

test("a job that is still running tells a reason Print Buddy knows, and stays in its state", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const { jobId, cupsJobId } = await server.print()

  const cases = [
    { cups: [JobState.pending, ["printer-stopped"], "", ["paused"]], state: "waiting", reason: "Der Drucker ist in CUPS angehalten." },
    { cups: [JobState.processing, ["job-printing"], "The printer is not responding.", ["none"]], state: "waiting", reason: "Der Drucker antwortet nicht. Ist er eingeschaltet?" },
    { cups: [JobState.processing, ["job-printing"], "Connecting to printer.", ["connecting-to-device"]], state: "waiting", reason: "Verbindung zum Drucker wird aufgebaut." },
    { cups: [JobState.processing, ["job-printing"], "", ["media-empty-warning"]], state: "printing", reason: "Kein Papier im Drucker." },
    { cups: [JobState.processing, ["job-printing"], "", ["cups-waiting-for-job-completed"]], state: "printing", reason: null },
  ] as const
  for (const { cups, state, reason } of cases) {
    server.printer.setJob(cupsJobId, cups[0], [...cups[1]], cups[2], [...cups[3]])
    const status = await readJob(server, jobId)
    assert.equal(status.state, state, JSON.stringify(cups))
    assert.equal(status.reason, reason, JSON.stringify(cups))
    assert.equal(status.endedAt, null)
  }
})
