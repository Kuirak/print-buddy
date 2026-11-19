import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test, type TestContext } from "node:test"
import { loadConfig } from "./config.ts"

async function optionsFile(t: TestContext, content: string) {
  const dir = await mkdtemp(join(tmpdir(), "print-buddy-config-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, "options.json")
  await writeFile(file, content)
  return file
}

test("printer_name and upload_limit_mb come from the add-on options file", async t => {
  const file = await optionsFile(t, JSON.stringify({ printer_name: "Office", upload_limit_mb: 20 }))

  const config = await loadConfig({ PRINT_BUDDY_OPTIONS_FILE: file })

  assert.equal(config.printerUri, "ipp://172.30.32.1:631/printers/Office")
  assert.equal(config.uploadLimitMb, 20)
})

test("a missing options file stops the start, because printer_name has no default", async () => {
  await assert.rejects(loadConfig({ PRINT_BUDDY_OPTIONS_FILE: join(tmpdir(), "print-buddy-no-such-dir", "options.json") }), /printer_name/)
})

test("a missing printer_name stops the start", async t => {
  const file = await optionsFile(t, JSON.stringify({ upload_limit_mb: 5 }))

  await assert.rejects(loadConfig({ PRINT_BUDDY_OPTIONS_FILE: file }), /printer_name is missing/)
})

test("every other key has the spec's default", async t => {
  const file = await optionsFile(t, JSON.stringify({ printer_name: "Office" }))

  const config = await loadConfig({ PRINT_BUDDY_OPTIONS_FILE: file })

  assert.deepEqual(config, {
    printerUri: "ipp://172.30.32.1:631/printers/Office",
    uploadLimitMb: 50,
    jobsDir: "/share/print-buddy/jobs",
    port: 9217,
  })
})

test("the CUPS host, the jobs directory and the port can be pointed elsewhere", async t => {
  const file = await optionsFile(t, JSON.stringify({ printer_name: "Office" }))

  const config = await loadConfig({ PRINT_BUDDY_OPTIONS_FILE: file, PRINT_BUDDY_CUPS: "127.0.0.1:6310", PRINT_BUDDY_JOBS_DIR: "/tmp/pb-jobs", PRINT_BUDDY_PORT: "4000" })

  assert.equal(config.printerUri, "ipp://127.0.0.1:6310/printers/Office")
  assert.equal(config.jobsDir, "/tmp/pb-jobs")
  assert.equal(config.port, 4000)
})
