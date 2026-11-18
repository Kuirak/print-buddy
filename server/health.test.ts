import assert from "node:assert/strict"
import { test } from "node:test"
import { startTestServer } from "./testing/harness.ts"

test("the health endpoint answers without touching CUPS", async t => {
  const server = await startTestServer()
  t.after(server.close)

  const res = await server.request("/health")

  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true })
  assert.equal(server.printer.requests.length, 0)
})
