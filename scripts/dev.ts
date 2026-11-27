// Local development against the fake IPP printer, with a temporary jobs directory. Nothing reaches a real printer.
// By default the page comes from Vite's dev server with hot reload, and the server only answers /api. With `--built`
// the server serves the built app from dist/ui on http://localhost:9217, with its service worker, as the add-on does.
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"
// pdf.js's fetched files, which Vite serves from ui/public (a build runs this too, so with `--built` it only repeats)
import "./pdfjs-assets.ts"
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
  // to try Dell's engine against the fake printer; foo2hbpl2, and mutool for PDFs, must be on the PATH then
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

if (process.argv.includes("--built")) {
  console.log(`Print Buddy: http://localhost:${config.port}`)
} else {
  const vite = await createServer({
    configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
    // the fake printer's server may listen elsewhere than the port vite.config.ts proxies to
    server: { proxy: { "/api": `http://127.0.0.1:${config.port}` } },
  })
  await vite.listen()
  console.log("Print Buddy with hot reload:")
  vite.printUrls()
}
console.log(`Fake printer: ${printer.uri}`)
console.log(`Jobs directory: ${config.jobsDir}`)
