// Local development: Print Buddy on http://localhost:9217 against the fake IPP printer,
// with a temporary jobs directory. Nothing reaches a real printer.
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadConfig } from "../server/config.ts"
import { JobState } from "../server/printer/ipp-codec.ts"
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
  // to try Dell's engine against the fake printer; foo2hbpl2 must be on the PATH then
  PRINT_BUDDY_DELL_ENGINE: process.env.PRINT_BUDDY_DELL_ENGINE,
  PRINT_BUDDY_CUPS: printer.cups,
})
await startServer(config)

// The fake printer moves a job only when a test tells it to. Here it prints like a quick real one: Wartet for 5 s,
// so that "Abbrechen" can still be tried, then Wird gedruckt for 5 s, then Fertig.
const arrived = new Map<number, number>()
setInterval(() => {
  for (const job of printer.jobs.values()) {
    if (!arrived.has(job.id)) arrived.set(job.id, Date.now())
    const age = Date.now() - arrived.get(job.id)!
    if (job.state === JobState.pending && age >= 5000) printer.setJob(job.id, JobState.processing, ["job-printing"])
    else if (job.state === JobState.processing && age >= 10_000) printer.setJob(job.id, JobState.completed, ["job-completed-successfully"])
  }
}, 1000)

console.log(`Print Buddy: http://localhost:${config.port}`)
console.log(`Fake printer: ${printer.uri}`)
console.log(`Jobs directory: ${config.jobsDir}`)
