// Seam 1 harness: the real server on a random port, against the fake IPP printer,
// with a temporary directory in place of /share and /data, and a clock the test controls.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadConfig } from "../config.ts"
import { startServer } from "../server.ts"
import type { PrintOptions } from "../../shared/print-options.ts"
import { startFakeIpp, type FakeIpp } from "./fake-ipp.ts"
import { samplePdf, samplePrintOptions } from "./fixtures.ts"

export interface TestServerOptions {
  /** Extra or overriding keys for the add-on options file. `printer_uri` defaults to the fake printer. */
  options?: Record<string, unknown>
  /** Start time of the fake clock, in ms since the epoch. */
  now?: number
  /** Files of a stand-in UI build, by relative path. */
  ui?: Record<string, string>
  /** Runs before the server starts, to script what the printer answers to the startup read of the margins. */
  beforeStart?: (printer: FakeIpp) => void
}

export type TestServer = Awaited<ReturnType<typeof startTestServer>>

export async function startTestServer(opts: TestServerOptions = {}) {
  const dir = await mkdtemp(join(tmpdir(), "print-buddy-test-"))
  const printer = await startFakeIpp()
  opts.beforeStart?.(printer)

  const optionsFile = join(dir, "data", "options.json")
  await mkdir(join(dir, "data"))
  await writeFile(optionsFile, JSON.stringify({ printer_uri: printer.uri, ...opts.options }))

  const uiDir = join(dir, "ui")
  for (const [path, content] of Object.entries({ "index.html": "<!doctype html><title>Print Buddy</title>", ...opts.ui })) {
    await mkdir(join(uiDir, path, ".."), { recursive: true })
    await writeFile(join(uiDir, path), content)
  }

  let time = opts.now ?? Date.UTC(2026, 10, 19, 12, 0, 0)
  const clock = {
    now: () => time,
    advance(ms: number) { time += ms },
  }

  const jobsDir = join(dir, "share", "print-buddy", "jobs")
  const config = await loadConfig({
    PRINT_BUDDY_OPTIONS_FILE: optionsFile,
    PRINT_BUDDY_JOBS_DIR: jobsDir,
    PRINT_BUDDY_PORT: "0",
  })
  // what the server asks the printer while starting is set aside, so `printer.requests` holds only what a test caused
  const startupRequests: typeof printer.requests = []
  async function start() {
    const asked = printer.requests.length
    const running = await startServer(config, { now: clock.now, hostname: "127.0.0.1", uiDir })
    startupRequests.push(...printer.requests.splice(asked))
    return running
  }
  let server = await start()

  const request = (path: string, init?: RequestInit) => fetch(server.url + path, init)
  const post = (path: string, body?: unknown) => request(path, {
    method: "POST",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  })

  const submit = (draftId: string, overrides: Partial<PrintOptions> = {}) => post(`/api/drafts/${draftId}/submit`, { ...samplePrintOptions, ...overrides })
  function upload(draftId: string, bytes: Uint8Array<ArrayBuffer>, name: string, type = "application/octet-stream") {
    const form = new FormData()
    form.set("file", new File([bytes], name, { type }))
    return request(`/api/drafts/${draftId}/files`, { method: "POST", body: form })
  }

  return {
    /** Changes with `restart()`. */
    get url() { return server.url },
    /**
     * The fake IPP printer: `printer.requests`, `printer.jobs`, `printer.setJob(...)`, `printer.printer`.
     * `printer.requests` starts empty: see `startupRequests`.
     */
    printer,
    /** The IPP requests the server made while it started (the read of the printable margins), restarts included. */
    startupRequests,
    /** Stands in for /share/print-buddy/jobs. */
    jobsDir,
    clock,
    request,
    /** POST a JSON body (or none). */
    post,
    /** Submit a draft with `samplePrintOptions`, changed by `overrides`. */
    submit,
    /** Add one file to a draft the way the app does: multipart, field `file`. */
    upload,
    /**
     * Send a Print Job the way the app does: a new draft, one upload per file, then a submit with
     * `samplePrintOptions`, changed by `overrides`. Without `files` it is `samplePdf()`.
     */
    async print(overrides: Partial<PrintOptions> = {}, files: Uint8Array<ArrayBuffer>[] = [samplePdf()]) {
      const { draftId } = await (await post("/api/drafts")).json() as { draftId: string }
      for (const [i, file] of files.entries()) await upload(draftId, file, `file-${i + 1}`)
      return await (await submit(draftId, overrides)).json() as { jobId: string; cupsJobId: number }
    },
    /** What the server does every hour: delete old job folders and drafts. Call it after `clock.advance(…)`. */
    cleanup: () => server.cleanup(),
    /** Stops the server and starts it again on the same directories, as a restart of the add-on does. */
    async restart() {
      await server.close()
      server = await start()
    },
    async close() {
      await server.close()
      await printer.close()
      await rm(dir, { recursive: true, force: true })
    },
  }
}
