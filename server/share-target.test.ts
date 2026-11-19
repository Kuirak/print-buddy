import assert from "node:assert/strict"
import { test } from "node:test"
import { samplePdf } from "./testing/fixtures.ts"
import { startTestServer } from "./testing/harness.ts"

test("a share that reaches the server, because no service worker took it, is not kept: the app is told that it was lost", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const form = new FormData()
  form.append("file", new Blob([samplePdf()], { type: "application/pdf" }), "Rechnung.pdf")

  const res = await server.request("/share-target", { method: "POST", body: form, redirect: "manual" })

  // 303, so that the browser follows with a GET and a reload doesn't send the files again
  assert.equal(res.status, 303)
  assert.equal(res.headers.get("location"), "/?shared=lost")
})

test("coming back to the share address after the login tells the app that the share was lost as well", async t => {
  const server = await startTestServer()
  t.after(server.close)

  const res = await server.request("/share-target", { redirect: "manual" })

  assert.equal(res.status, 303)
  assert.equal(res.headers.get("location"), "/?shared=lost")
})

test("the manifest and the service worker are served as what they are and re-checked on every open", async t => {
  const server = await startTestServer({
    ui: { "manifest.webmanifest": '{"name":"Print Buddy"}', "sw.js": "// build abc123" },
  })
  t.after(server.close)

  const manifest = await server.request("/manifest.webmanifest")
  assert.equal(manifest.status, 200)
  assert.equal(manifest.headers.get("content-type"), "application/manifest+json")
  assert.equal(manifest.headers.get("cache-control"), "no-cache")

  const worker = await server.request("/sw.js")
  assert.equal(worker.status, 200)
  assert.match(worker.headers.get("content-type") ?? "", /javascript/)
  assert.equal(worker.headers.get("cache-control"), "no-cache")
  assert.equal(await worker.text(), "// build abc123")
})
