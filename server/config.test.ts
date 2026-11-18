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

test("printer_uri and upload_limit_mb come from the add-on options file", async t => {
  const file = await optionsFile(t, JSON.stringify({ printer_uri: "ipp://10.0.0.5:631/printers/Other", upload_limit_mb: 20 }))

  const config = await loadConfig({ PRINT_BUDDY_OPTIONS_FILE: file })

  assert.equal(config.printerUri, "ipp://10.0.0.5:631/printers/Other")
  assert.equal(config.uploadLimitMb, 20)
})

test("a missing options file gives the spec's defaults", async () => {
  const config = await loadConfig({ PRINT_BUDDY_OPTIONS_FILE: join(tmpdir(), "print-buddy-no-such-dir", "options.json") })

  assert.deepEqual(config, {
    printerUri: "ipp://172.30.32.1:631/printers/Printer",
    uploadLimitMb: 50,
    jobsDir: "/share/print-buddy/jobs",
    port: 9217,
  })
})

test("a missing key gives that key's default", async t => {
  const file = await optionsFile(t, JSON.stringify({ upload_limit_mb: 5 }))

  const config = await loadConfig({ PRINT_BUDDY_OPTIONS_FILE: file })

  assert.equal(config.printerUri, "ipp://172.30.32.1:631/printers/Printer")
  assert.equal(config.uploadLimitMb, 5)
})

test("the jobs directory and the port can be pointed elsewhere", async t => {
  const file = await optionsFile(t, "{}")

  const config = await loadConfig({ PRINT_BUDDY_OPTIONS_FILE: file, PRINT_BUDDY_JOBS_DIR: "/tmp/pb-jobs", PRINT_BUDDY_PORT: "4000" })

  assert.equal(config.jobsDir, "/tmp/pb-jobs")
  assert.equal(config.port, 4000)
})
