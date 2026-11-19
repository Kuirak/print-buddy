import assert from "node:assert/strict"
import { test } from "node:test"
import type { JobStatus } from "../shared/api.ts"
import { JobState, Op, Tag, values } from "./printer/ipp-codec.ts"
import { startTestServer, type TestServer } from "./testing/harness.ts"

const cancelRequests = (server: TestServer) => server.printer.requests.filter(request => request.code === Op.cancelJob)

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

test("a Print Job can no longer be cancelled once it is being printed", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const { jobId, cupsJobId } = await server.print()
  server.printer.setJob(cupsJobId, JobState.processing, ["job-printing"], "Connected to printer.")

  const res = await server.post(`/api/jobs/${jobId}/cancel`)

  assert.equal(res.status, 409)
  assert.deepEqual(await res.json(), { error: "not-cancellable" })
  assert.equal(cancelRequests(server).length, 0)
  const status = await (await server.request(`/api/jobs/${jobId}`)).json() as JobStatus
  assert.equal(status.state, "printing")
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

test("a job the Printer has not taken yet can still be cancelled, even though CUPS calls it processing", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const { jobId, cupsJobId } = await server.print()
  server.printer.setJob(cupsJobId, JobState.processing, ["job-printing"], "The printer is not responding.")

  const res = await server.post(`/api/jobs/${jobId}/cancel`)

  assert.equal(res.status, 200)
  assert.equal((await res.json() as JobStatus).state, "cancelled")
  assert.equal(cancelRequests(server).length, 1)
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
