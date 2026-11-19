import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { startFakeIpp } from "./testing/fake-ipp.ts"

// The add-on runs with `init: false`, so node is PID 1 and gets the Supervisor's SIGTERM itself.
test("SIGTERM stops the server cleanly, even with a connection still open", async t => {
  const dir = await mkdtemp(join(tmpdir(), "print-buddy-shutdown-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  // a printer that answers: without one the server waits 5 s for the margins before it listens
  const printer = await startFakeIpp()
  t.after(printer.close)
  await writeFile(join(dir, "options.json"), JSON.stringify({ printer_uri: printer.uri }))

  const child = spawn(process.execPath, [join(import.meta.dirname, "main.ts")], {
    env: {
      ...process.env,
      PRINT_BUDDY_OPTIONS_FILE: join(dir, "options.json"),
      PRINT_BUDDY_JOBS_DIR: join(dir, "jobs"),
      PRINT_BUDDY_PORT: "0",
    },
    stdio: ["ignore", "pipe", "inherit"],
  })
  t.after(() => { child.kill("SIGKILL") })

  let output = ""
  const listening = Promise.withResolvers<string>()
  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (chunk: string) => {
    output += chunk
    const match = /listening on port (\d+)/.exec(output)
    if (match) listening.resolve(match[1]!)
  })
  const port = await listening.promise
  // a keep-alive connection, as the HA watchdog or cloudflared would hold
  const res = await fetch(`http://127.0.0.1:${port}/health`)
  assert.equal(res.status, 200)
  await res.arrayBuffer()

  const exited = once(child, "exit")
  child.kill("SIGTERM")
  const [code, signal] = await exited

  assert.equal(signal, null)
  assert.equal(code, 0)
})
