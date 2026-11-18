import assert from "node:assert/strict"
import { test } from "node:test"
import { startTestServer } from "./testing/harness.ts"

test("the server serves the built UI next to the API", async t => {
  const server = await startTestServer({
    ui: { "index.html": "<!doctype html><title>Print Buddy</title>", "assets/app-abc123.js": "console.log(1)" },
  })
  t.after(server.close)

  const page = await server.request("/")
  assert.equal(page.status, 200)
  assert.match(page.headers.get("content-type") ?? "", /^text\/html/)
  assert.equal(await page.text(), "<!doctype html><title>Print Buddy</title>")
  // the page must be re-checked on every open, so a new version is picked up
  assert.equal(page.headers.get("cache-control"), "no-cache")

  const asset = await server.request("/assets/app-abc123.js")
  assert.equal(asset.status, 200)
  assert.match(asset.headers.get("content-type") ?? "", /javascript/)
  assert.equal(await asset.text(), "console.log(1)")
  assert.equal(asset.headers.get("cache-control"), "public, immutable, max-age=31536000")
})

test("a file the UI build does not contain is a 404", async t => {
  const server = await startTestServer()
  t.after(server.close)

  const res = await server.request("/favicon.ico")

  assert.equal(res.status, 404)
})
