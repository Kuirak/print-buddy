import assert from "node:assert/strict"
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"
import type { JobStatus } from "../shared/api.ts"
import { JobState, Op } from "./printer/ipp-codec.ts"
import { sampleJpeg, samplePdf, samplePng, samplePrintOptions } from "./testing/fixtures.ts"
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
    file: { kind: "pdf", bytes: samplePdf().length, count: 1 },
    options: {
      copies: 2, color: "color", paper: "A4", quality: "normal",
      printSize: { kind: "fit" }, position: "center", pagesPerSheet: 1, rotation: 0, selection: [1],
    },
    details: { jobState: "pending", jobStateReasons: ["none"], printerStateReasons: [], printerMessage: "" },
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
    details: { jobState: "processing", jobStateReasons: ["job-printing"], printerStateReasons: ["none"], printerMessage: "Connected to printer." },
    endedAt: null,
    cancelled: false,
  })

  server.clock.advance(75_000)
  server.printer.setJob(cupsJobId, JobState.completed, ["job-completed-successfully"], "Print file sent.")
  await server.request(`/api/jobs/${jobId}`)
  assert.deepEqual(await recorded(server, jobId), {
    details: { jobState: "completed", jobStateReasons: ["job-completed-successfully"], printerStateReasons: ["none"], printerMessage: "Print file sent." },
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

test("a Print Job that CUPS accepted is answered and can be followed, even when its folder can't be filled", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const { draftId } = await (await server.post("/api/drafts")).json() as { draftId: string }
  await server.upload(draftId, sampleJpeg(), "IMG_0001.jpg")
  await server.upload(draftId, samplePng(20, 10), "IMG_0002.png")
  // the second photo is left out of the Print Job, so the first thing to fail is moving it into the job folder
  await rm(join(server.jobsDir, "drafts", draftId, "2.png"))

  const submitted = await server.submit(draftId, { selection: [0] })

  assert.equal(submitted.status, 201, await submitted.clone().text())
  const { jobId, cupsJobId } = await submitted.json() as { jobId: string; cupsJobId: number }
  assert.deepEqual([...server.printer.jobs.keys()], [cupsJobId])
  server.printer.setJob(cupsJobId, JobState.completed, ["job-completed-successfully"])
  assert.equal((await (await server.request(`/api/jobs/${jobId}`)).json() as JobStatus).state, "done")
  // nothing is left that could be sent a second time
  assert.equal((await server.submit(draftId, { selection: [0] })).status, 404)
  assert.equal(server.printer.requests.filter(request => request.code === Op.printJob).length, 1)
})

test("a Print Job can still be followed when its job.json can't be written any more", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const { jobId, cupsJobId } = await server.print()
  const [folder] = await jobFolders(server.jobsDir)
  await rm(join(server.jobsDir, folder!), { recursive: true })
  server.printer.setJob(cupsJobId, JobState.processing, ["job-printing"], "Connected to printer.")

  const read = await server.request(`/api/jobs/${jobId}`)

  assert.equal(read.status, 200)
  assert.equal((await read.json() as JobStatus).state, "printing")
  server.printer.setJob(cupsJobId, JobState.completed, ["job-completed-successfully"])
  assert.equal((await (await server.request(`/api/jobs/${jobId}`)).json() as JobStatus).state, "done")
})

test("a Print Job can still be read, and still follows CUPS, after the server restarts", async t => {
  const sentAt = Date.UTC(2026, 10, 19, 8, 30, 0)
  const server = await startTestServer({ now: sentAt })
  t.after(server.close)
  const { jobId, cupsJobId } = await server.print({ copies: 3 })
  server.printer.setJob(cupsJobId, JobState.processing, ["job-printing"], "Connected to printer.")
  const before = await (await server.request(`/api/jobs/${jobId}`)).json()

  await server.restart()

  const after = await server.request(`/api/jobs/${jobId}`)
  assert.equal(after.status, 200)
  assert.deepEqual(await after.json(), before)
  assert.deepEqual(before, {
    jobId,
    state: "printing",
    reason: null,
    details: { jobState: "processing", jobStateReasons: ["job-printing"], printerStateReasons: ["none"], printerMessage: "Connected to printer." },
    cupsJobId: 1,
    sentAt,
    endedAt: null,
    sheets: 3,
    file: { kind: "pdf", bytes: samplePdf().length, count: 1 },
    options: { ...samplePrintOptions, copies: 3 },
  })

  server.clock.advance(20_000)
  server.printer.setJob(cupsJobId, JobState.completed, ["job-completed-successfully"], "Print file sent.")
  const ended = await (await server.request(`/api/jobs/${jobId}`)).json() as JobStatus
  assert.equal(ended.state, "done")
  assert.equal(ended.endedAt, sentAt + 20_000)
  assert.equal((await recorded(server, jobId)).endedAt, "2026-11-19T08:30:20.000Z")
})

const minute = 60_000
const hour = 60 * minute
const day = 24 * hour

test("cleanup deletes the job folders that are older than 7 days, and those Print Jobs are gone", async t => {
  const server = await startTestServer({ now: Date.UTC(2026, 10, 19, 8, 30, 0) })
  t.after(server.close)
  const old = await server.print()
  server.clock.advance(3 * day)
  const recent = await server.print()

  server.clock.advance(4 * day - minute)
  await server.cleanup()
  assert.deepEqual(await jobFolders(server.jobsDir), [`2026-11-19_${old.jobId}`, `2026-11-22_${recent.jobId}`])

  server.clock.advance(2 * minute)
  await server.cleanup()
  assert.deepEqual(await jobFolders(server.jobsDir), [`2026-11-22_${recent.jobId}`])
  assert.equal((await server.request(`/api/jobs/${old.jobId}`)).status, 404)
  assert.equal((await server.request(`/api/jobs/${recent.jobId}`)).status, 200)
})

test("the server cleans up when it starts", async t => {
  const server = await startTestServer({ now: Date.UTC(2026, 10, 19, 8, 30, 0) })
  t.after(server.close)
  const { jobId } = await server.print()

  server.clock.advance(8 * day)
  await server.restart()

  assert.deepEqual(await jobFolders(server.jobsDir), [])
  assert.equal((await server.request(`/api/jobs/${jobId}`)).status, 404)
})

test("a job folder whose job.json can't be read is deleted 7 days after the day in its name", async t => {
  const server = await startTestServer({ now: Date.UTC(2026, 10, 19, 8, 30, 0) })
  t.after(server.close)
  const { jobId } = await server.print()
  const folder = `2026-11-19_${jobId}`
  await writeFile(join(server.jobsDir, folder, "job.json"), '{ "id": ')
  await server.restart()

  // the folder can be from any time of that day, so it counts from the day's end: until 27 November, 0:00 UTC
  server.clock.advance(Date.UTC(2026, 10, 26, 23, 59, 0) - server.clock.now())
  await server.cleanup()
  assert.deepEqual(await jobFolders(server.jobsDir), [folder])

  server.clock.advance(2 * minute)
  await server.cleanup()
  assert.deepEqual(await jobFolders(server.jobsDir), [])
})

test("cleanup deletes a draft that was not submitted within 1 hour", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const { draftId } = await (await server.post("/api/drafts")).json() as { draftId: string }
  await server.upload(draftId, sampleJpeg(), "IMG_0001.jpg")

  server.clock.advance(59 * minute)
  await server.cleanup()
  assert.deepEqual(await readdir(join(server.jobsDir, "drafts")), [draftId])
  assert.equal((await server.upload(draftId, samplePng(20, 10), "IMG_0002.png")).status, 201)

  server.clock.advance(2 * minute)
  await server.cleanup()
  assert.deepEqual(await readdir(join(server.jobsDir, "drafts")), [])
  assert.equal((await server.upload(draftId, samplePng(20, 10), "IMG_0003.png")).status, 404)
  assert.equal((await server.submit(draftId, { selection: [0, 1] })).status, 404)
  assert.equal(server.printer.requests.length, 0)
})

test("a draft that an earlier run of the server left behind is deleted when the server starts", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const { draftId } = await (await server.post("/api/drafts")).json() as { draftId: string }
  await server.upload(draftId, samplePdf(), "a.pdf")

  await server.restart()

  assert.deepEqual(await readdir(join(server.jobsDir, "drafts")), [])
  assert.equal((await server.submit(draftId)).status, 404)
})

test("cleanup deletes nothing but job folders and drafts", async t => {
  const server = await startTestServer({ now: Date.UTC(2026, 10, 19, 8, 30, 0) })
  t.after(server.close)
  await server.print()
  await server.post("/api/drafts")
  // what somebody might put there with File Browser or Samba
  const strangers = ["Notizen.txt", "Sicherung/alt.pdf", "2026-11-01_Urlaub/foto.jpg", "drafts/LIESMICH.txt", "drafts/Ablage/brief.pdf"]
  for (const path of strangers) {
    await mkdir(join(server.jobsDir, path, ".."), { recursive: true })
    await writeFile(join(server.jobsDir, path), "bleibt")
  }

  server.clock.advance(30 * day)
  await server.cleanup()
  await server.restart()

  assert.deepEqual((await readdir(server.jobsDir, { recursive: true })).sort(), [
    "2026-11-01_Urlaub", "2026-11-01_Urlaub/foto.jpg", "Notizen.txt", "Sicherung", "Sicherung/alt.pdf",
    "drafts", "drafts/Ablage", "drafts/Ablage/brief.pdf", "drafts/LIESMICH.txt",
  ])
})
