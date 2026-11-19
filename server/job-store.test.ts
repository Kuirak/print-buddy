import assert from "node:assert/strict"
import { readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"
import { JobState } from "./printer/ipp-codec.ts"
import { sampleJpeg, samplePdf, samplePng } from "./testing/fixtures.ts"
import { startTestServer, type TestServer } from "./testing/harness.ts"

/** What lies in the jobs directory besides the drafts. */
const jobFolders = async (jobsDir: string) => (await readdir(jobsDir)).filter(name => name !== "drafts").sort()

/** The parts of a job's job.json that change after the job was sent. */
async function recorded(server: TestServer, jobId: string) {
  const [folder] = (await readdir(server.jobsDir)).filter(name => name.endsWith(jobId))
  const { details, endedAt, cancelled } = JSON.parse(await readFile(join(server.jobsDir, folder!, "job.json"), "utf8"))
  return { details, endedAt, cancelled }
}

test("a Print Job has one folder, named by date and job id, with the upload, the PDF CUPS got and job.json", async t => {
  const server = await startTestServer({ now: Date.UTC(2026, 10, 19, 8, 30, 0) })
  t.after(server.close)
  const upload = samplePdf()

  const { jobId } = await server.print({}, [upload])

  assert.deepEqual(await jobFolders(server.jobsDir), [`2026-11-19_${jobId}`])
  const folder = join(server.jobsDir, `2026-11-19_${jobId}`)
  assert.deepEqual((await readdir(folder)).sort(), ["job.json", "print.pdf", "upload-1.pdf"])
  assert.deepEqual(await readFile(join(folder, "upload-1.pdf")), Buffer.from(upload))
  assert.deepEqual(await readFile(join(folder, "print.pdf")), Buffer.from(server.printer.requests[0]!.data))
})

test("job.json holds the Print Options, sheet count, CUPS job number, times and what CUPS last said, and nothing about people", async t => {
  const server = await startTestServer({ now: Date.UTC(2026, 10, 19, 8, 30, 0) })
  t.after(server.close)
  const { draftId } = await (await server.post("/api/drafts")).json() as { draftId: string }
  await server.upload(draftId, samplePdf(), "Brief von Anna Beispiel anna@example.org.pdf", "application/pdf")

  const { jobId } = await (await server.submit(draftId, { copies: 2, color: "color" })).json() as { jobId: string }

  const folder = join(server.jobsDir, `2026-11-19_${jobId}`)
  const text = await readFile(join(folder, "job.json"), "utf8")
  assert.deepEqual(JSON.parse(text), {
    id: jobId,
    cupsJobId: 1,
    sentAt: "2026-11-19T08:30:00.000Z",
    endedAt: null,
    sheets: 2,
    options: {
      copies: 2, color: "color", paper: "A4", quality: "normal",
      printSize: { kind: "fit" }, position: "center", pagesPerSheet: 1, rotation: 0, selection: [1],
    },
    details: { jobState: "pending", jobStateReasons: ["none"], printerMessage: "" },
    cancelled: false,
  })
  assert.doesNotMatch(text + (await readdir(folder)).join(), /Anna|Beispiel|example\.org/)
})

test("the photos of a Print Job move from the draft into the job folder, in upload order", async t => {
  const server = await startTestServer({ now: Date.UTC(2026, 10, 19, 8, 30, 0) })
  t.after(server.close)
  const [jpeg, png] = [sampleJpeg(), samplePng(20, 10)]
  const { draftId } = await (await server.post("/api/drafts")).json() as { draftId: string }
  await server.upload(draftId, jpeg, "IMG_0001.jpg")
  await server.upload(draftId, png, "IMG_0002.png")

  const { jobId } = await (await server.submit(draftId, { selection: [0, 1] })).json() as { jobId: string }

  const folder = join(server.jobsDir, `2026-11-19_${jobId}`)
  assert.deepEqual((await readdir(folder)).sort(), ["job.json", "print.pdf", "upload-1.jpg", "upload-2.png"])
  assert.deepEqual(await readFile(join(folder, "upload-1.jpg")), Buffer.from(jpeg))
  assert.deepEqual(await readFile(join(folder, "upload-2.png")), Buffer.from(png))
  assert.deepEqual(await readdir(join(server.jobsDir, "drafts")), [])
  assert.equal((await server.submit(draftId, { selection: [0, 1] })).status, 404)
})

test("job.json follows the Print Job: what CUPS last said, and when the job ended", async t => {
  const server = await startTestServer({ now: Date.UTC(2026, 10, 19, 8, 30, 0) })
  t.after(server.close)
  const { jobId, cupsJobId } = await server.print()

  server.printer.setJob(cupsJobId, JobState.processing, ["job-printing"], "Connected to printer.")
  await server.request(`/api/jobs/${jobId}`)
  assert.deepEqual(await recorded(server, jobId), {
    details: { jobState: "processing", jobStateReasons: ["job-printing"], printerMessage: "Connected to printer." },
    endedAt: null,
    cancelled: false,
  })

  server.clock.advance(75_000)
  server.printer.setJob(cupsJobId, JobState.completed, ["job-completed-successfully"], "Print file sent.")
  await server.request(`/api/jobs/${jobId}`)
  assert.deepEqual(await recorded(server, jobId), {
    details: { jobState: "completed", jobStateReasons: ["job-completed-successfully"], printerMessage: "Print file sent." },
    endedAt: "2026-11-19T08:31:15.000Z",
    cancelled: false,
  })
})

test("job.json says when Print Buddy cancelled the Print Job itself", async t => {
  const server = await startTestServer({ now: Date.UTC(2026, 10, 19, 8, 30, 0) })
  t.after(server.close)
  const { jobId } = await server.print()
  server.clock.advance(12_000)

  await server.post(`/api/jobs/${jobId}/cancel`)

  const { details, endedAt, cancelled } = await recorded(server, jobId)
  assert.equal(cancelled, true)
  assert.equal(details.jobState, "canceled")
  assert.equal(endedAt, "2026-11-19T08:30:12.000Z")
})

test("job.json is written again only when something about the Print Job changed", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const { jobId, cupsJobId } = await server.print()
  const [folder] = await jobFolders(server.jobsDir)
  const writtenAt = async () => (await stat(join(server.jobsDir, folder!, "job.json"), { bigint: true })).mtimeNs
  server.printer.setJob(cupsJobId, JobState.processing, ["job-printing"], "Connected to printer.")
  await server.request(`/api/jobs/${jobId}`)
  const before = await writtenAt()

  await server.request(`/api/jobs/${jobId}`)
  await server.request(`/api/jobs/${jobId}`)

  assert.equal(await writtenAt(), before)
})
