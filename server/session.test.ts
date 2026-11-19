import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"
import { Tag, values } from "./printer/ipp-codec.ts"
import { samplePdf, samplePrintOptions } from "./testing/fixtures.ts"
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

test("the login address sends the browser back into the app, which is where the person lands after the Cloudflare login", async t => {
  const server = await startTestServer()
  t.after(server.close)

  const res = await server.request("/login", { redirect: "manual" })

  assert.equal(res.status, 303)
  assert.equal(res.headers.get("location"), "/?logged-in=1")
})

test("the server reads no identity from Cloudflare's headers: what they say reaches neither an answer, nor CUPS, nor the job folder", async t => {
  const server = await startTestServer()
  t.after(server.close)
  // what Cloudflare Access adds to every request it lets through
  const fromCloudflare = {
    "Cf-Access-Authenticated-User-Email": "anna@example.org",
    "Cf-Access-Jwt-Assertion": "eyJhbGciOiJSUzI1NiJ9.anna-token.signature",
    Cookie: "CF_Authorization=anna-cookie",
  }
  const answers: string[] = []
  async function ask(path: string, init: RequestInit = {}) {
    const res = await server.request(path, { ...init, headers: { ...fromCloudflare, ...init.headers } })
    const text = await res.text()
    answers.push(text)
    return JSON.parse(text)
  }

  // a whole Print Job, the way the app sends one through Cloudflare
  await ask("/api/session")
  const { draftId } = await ask("/api/drafts", { method: "POST" })
  const form = new FormData()
  form.set("file", new File([samplePdf()], "a.pdf", { type: "application/pdf" }))
  await ask(`/api/drafts/${draftId}/files`, { method: "POST", body: form })
  const { jobId } = await ask(`/api/drafts/${draftId}/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(samplePrintOptions),
  })
  const status = await ask(`/api/jobs/${jobId}`)
  assert.equal(status.state, "waiting")

  const identity = /anna|example\.org|eyJ/i
  assert.doesNotMatch(answers.join("\n"), identity)
  // CUPS: Print-Job and Get-Job-Attributes, both under the one fixed user name
  assert.equal(server.printer.requests.length, 2)
  for (const request of server.printer.requests) {
    assert.deepEqual(values(request, Tag.operation, "requesting-user-name"), ["print-buddy"])
    assert.doesNotMatch(JSON.stringify(request.groups), identity)
  }
  const [folder] = (await readdir(server.jobsDir)).filter(name => name.endsWith(jobId))
  assert.doesNotMatch(folder + await readFile(join(server.jobsDir, folder!, "job.json"), "utf8"), identity)
})
