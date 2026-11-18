import assert from "node:assert/strict"
import { test } from "node:test"
import { startTestServer } from "./testing/harness.ts"

test("the session check answers when the request gets through", async t => {
  const server = await startTestServer()
  t.after(server.close)

  const res = await server.request("/api/session")

  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true })
})

test("an unknown API path is a JSON 404, not the app", async t => {
  const server = await startTestServer()
  t.after(server.close)

  const res = await server.request("/api/nope")

  assert.equal(res.status, 404)
  assert.deepEqual(await res.json(), { error: "not-found" })
})
