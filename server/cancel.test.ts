import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"
import type { JobStatus } from "../shared/api.ts"
import { JobState, Op, Tag, values } from "./printer/ipp-codec.ts"
import { startTestServer, type TestServer } from "./testing/harness.ts"

const cancelRequests = (server: TestServer) => server.printer.requests.filter(request => request.code === Op.cancelJob)

/** What job.json says about how the job ended. */
async function recorded(server: TestServer, jobId: string) {
  const [folder] = (await readdir(server.jobsDir)).filter(name => name.endsWith(jobId))
  const { cancelled, endedAt, details } = JSON.parse(await readFile(join(server.jobsDir, folder!, "job.json"), "utf8"))
  return { cancelled, endedAt, jobState: details.jobState }
}

test("cancelling a waiting Print Job sends Cancel-Job as print-buddy, and the job reads as Abgebrochen", async t => {
  const sentAt = Date.UTC(2026, 10, 19, 8, 30, 0)
  const server = await startTestServer({ now: sentAt })
  t.after(server.close)
  const { jobId, cupsJobId } = await server.print()
  server.clock.advance(12_000)

  const res = await server.post(`/api/jobs/${jobId}/cancel`)

  assert.equal(res.status, 200)
  const status = await res.json() as JobStatus
  assert.equal(status.state, "cancelled")
  assert.equal(status.reason, null)
  assert.equal(status.endedAt, sentAt + 12_000)

  const [cancel, ...more] = cancelRequests(server)
  assert.equal(more.length, 0)
  assert.deepEqual(values(cancel!, Tag.operation, "requesting-user-name"), ["print-buddy"])
  assert.deepEqual(values(cancel!, Tag.operation, "printer-uri"), [server.printer.uri])
  assert.deepEqual(values(cancel!, Tag.operation, "job-id"), [cupsJobId])
  assert.equal(server.printer.jobs.get(cupsJobId)!.state, JobState.canceled)

  assert.deepEqual(await (await server.request(`/api/jobs/${jobId}`)).json(), status)
})

test("a status read that is still waiting for CUPS when the Print Job is cancelled doesn't undo the cancel", async t => {
  const sentAt = Date.UTC(2026, 10, 19, 8, 30, 0)
  const server = await startTestServer({ now: sentAt })
  t.after(server.close)
  const { jobId } = await server.print()
  // CUPS answers the status read from before the cancel, and the answer arrives after it
  const answer = server.printer.hold(Op.getJobAttributes)
  const read = server.request(`/api/jobs/${jobId}`)
  await answer.arrived

  server.clock.advance(12_000)
  const cancelled = await (await server.post(`/api/jobs/${jobId}/cancel`)).json() as JobStatus
  server.clock.advance(3_000)
  answer.release()

  assert.equal(cancelled.state, "cancelled")
  assert.equal(cancelled.endedAt, sentAt + 12_000)
  assert.deepEqual(await (await read).json(), cancelled)
  assert.deepEqual(await (await server.request(`/api/jobs/${jobId}`)).json(), cancelled)
  assert.deepEqual(await recorded(server, jobId), { cancelled: true, endedAt: "2026-11-19T08:30:12.000Z", jobState: "canceled" })
})

test("a status read that comes while CUPS is still answering the cancel reads Abgebrochen as well", async t => {
  const sentAt = Date.UTC(2026, 10, 19, 8, 30, 0)
  const server = await startTestServer({ now: sentAt })
  t.after(server.close)
  const { jobId } = await server.print()
  // CUPS has cancelled the job, and its answer to the Cancel-Job is not there yet
  const answer = server.printer.hold(Op.cancelJob)
  server.clock.advance(12_000)
  const cancel = server.post(`/api/jobs/${jobId}/cancel`)
  await answer.arrived

  const read = await (await server.request(`/api/jobs/${jobId}`)).json() as JobStatus
  server.clock.advance(3_000)
  answer.release()

  assert.equal(read.state, "cancelled")
  assert.equal(read.endedAt, sentAt + 12_000)
  assert.deepEqual(await (await cancel).json(), read)
  assert.deepEqual(await recorded(server, jobId), { cancelled: true, endedAt: "2026-11-19T08:30:12.000Z", jobState: "canceled" })
})

test("a Print Job that is being printed can be cancelled as well", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const { jobId, cupsJobId } = await server.print()
  server.printer.setJob(cupsJobId, JobState.processing, ["job-printing"], "Connected to printer.")

  const res = await server.post(`/api/jobs/${jobId}/cancel`)

  assert.equal(res.status, 200)
  assert.equal((await res.json() as JobStatus).state, "cancelled")
  assert.equal(cancelRequests(server).length, 1)
})

test("a Print Job that has ended can't be cancelled", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const { jobId, cupsJobId } = await server.print()
  server.printer.setJob(cupsJobId, JobState.completed, ["job-completed-successfully"])

  const res = await server.post(`/api/jobs/${jobId}/cancel`)

  assert.equal(res.status, 409)
  assert.deepEqual(await res.json(), { error: "not-cancellable" })
  assert.equal(cancelRequests(server).length, 0)
  const status = await (await server.request(`/api/jobs/${jobId}`)).json() as JobStatus
  assert.equal(status.state, "done")
})

test("when CUPS refuses the Cancel-Job because the job belongs to someone else, the cancel is refused", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const { jobId, cupsJobId } = await server.print()
  server.printer.jobs.get(cupsJobId)!.user = "someone-else"

  const res = await server.post(`/api/jobs/${jobId}/cancel`)

  assert.equal(res.status, 409)
  assert.deepEqual(await res.json(), { error: "not-cancellable" })
  assert.equal(server.printer.jobs.get(cupsJobId)!.state, JobState.pending)
  const status = await (await server.request(`/api/jobs/${jobId}`)).json() as JobStatus
  assert.equal(status.state, "waiting")
})

test("cancelling a Print Job that does not exist is a 404", async t => {
  const server = await startTestServer()
  t.after(server.close)

  const res = await server.post("/api/jobs/no-such-job/cancel")

  assert.equal(res.status, 404)
  assert.deepEqual(await res.json(), { error: "not-found" })
  assert.equal(server.printer.requests.length, 0)
})
