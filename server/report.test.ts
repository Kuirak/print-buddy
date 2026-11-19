import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"
import { PrinterState } from "./printer/ipp-codec.ts"
import { startTestServer } from "./testing/harness.ts"

test("the server's part of a report is the Print Buddy version of the add-on config and the Printer's state", async t => {
  const server = await startTestServer()
  t.after(server.close)
  server.printer.printer.state = PrinterState.stopped
  server.printer.printer.reasons = ["paused"]
  server.printer.printer.message = "Printer is paused"

  const res = await server.request("/api/report")

  const config = await readFile(join(import.meta.dirname, "..", "print-buddy", "config.yaml"), "utf8")
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), {
    version: /^version: "(.+)"$/m.exec(config)?.[1],
    printer: { state: "stopped", reasons: ["paused"], message: "Printer is paused" },
  })
})

test("the server's part of a report says so when CUPS doesn't answer", async t => {
  const server = await startTestServer()
  t.after(server.close)
  server.printer.unreachable = true

  const { version, printer } = await (await server.request("/api/report")).json()

  assert.match(version, /^\d{4}\.\d{2}\.\d+$/)
  assert.deepEqual(printer, { state: "unknown", reasons: [], message: "" })
})
