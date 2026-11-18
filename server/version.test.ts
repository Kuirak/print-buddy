import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"
import { startTestServer } from "./testing/harness.ts"

const root = join(import.meta.dirname, "..")

async function addonVersion() {
  const config = await readFile(join(root, "print-buddy", "config.yaml"), "utf8")
  return /^version: "(.+)"$/m.exec(config)?.[1]
}

test("the server reports the version of the add-on config", async t => {
  const server = await startTestServer()
  t.after(server.close)

  const { version } = await (await server.request("/health")).json()

  assert.match(version, /^\d{4}\.\d{2}\.\d+$/)
  assert.equal(version, await addonVersion())
})

test("the changelog's newest entry is the current version", async () => {
  const changelog = await readFile(join(root, "print-buddy", "CHANGELOG.md"), "utf8")

  assert.equal(/^## (\S+)/m.exec(changelog)?.[1], await addonVersion())
})
