// Local development: Print Buddy on http://localhost:9217 against the fake IPP printer,
// with a temporary jobs directory. Nothing reaches a real printer.
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadConfig } from "../server/config.ts"
import { startServer } from "../server/server.ts"
import { startFakeIpp } from "../server/testing/fake-ipp.ts"

const dir = await mkdtemp(join(tmpdir(), "print-buddy-dev-"))
const printer = await startFakeIpp()
const optionsFile = join(dir, "options.json")
await writeFile(optionsFile, JSON.stringify({ printer_name: printer.queue }))

const config = await loadConfig({
  PRINT_BUDDY_OPTIONS_FILE: optionsFile,
  PRINT_BUDDY_JOBS_DIR: join(dir, "jobs"),
  PRINT_BUDDY_PORT: process.env.PRINT_BUDDY_PORT,
  PRINT_BUDDY_CUPS: printer.cups,
})
await startServer(config)

console.log(`Print Buddy: http://localhost:${config.port}`)
console.log(`Fake printer: ${printer.uri}`)
console.log(`Jobs directory: ${config.jobsDir}`)
