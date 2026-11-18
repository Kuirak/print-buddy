// Seam 1 harness: the real server on a random port, against the fake IPP printer,
// with a temporary directory in place of /share and /data, and a clock the test controls.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadConfig } from "../config.ts"
import { startServer } from "../server.ts"
import { startFakeIpp } from "./fake-ipp.ts"

export interface TestServerOptions {
  /** Extra or overriding keys for the add-on options file. `printer_uri` defaults to the fake printer. */
  options?: Record<string, unknown>
  /** Start time of the fake clock, in ms since the epoch. */
  now?: number
  /** Files of a stand-in UI build, by relative path. */
  ui?: Record<string, string>
}

export type TestServer = Awaited<ReturnType<typeof startTestServer>>

export async function startTestServer(opts: TestServerOptions = {}) {
  const dir = await mkdtemp(join(tmpdir(), "print-buddy-test-"))
  const printer = await startFakeIpp()

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
  const server = await startServer(config, { now: clock.now, hostname: "127.0.0.1", uiDir })

  const request = (path: string, init?: RequestInit) => fetch(server.url + path, init)

  return {
    url: server.url,
    /** The fake IPP printer: `printer.requests`, `printer.jobs`, `printer.setJob(...)`, `printer.printer`. */
    printer,
    /** Stands in for /share/print-buddy/jobs. */
    jobsDir,
    clock,
    request,
    /** POST a JSON body (or none). */
    post: (path: string, body?: unknown) => request(path, {
      method: "POST",
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    }),
    /** Add one file to a draft the way the app does: multipart, field `file`. */
    upload(draftId: string, bytes: Uint8Array<ArrayBuffer>, name: string, type = "application/octet-stream") {
      const form = new FormData()
      form.set("file", new File([bytes], name, { type }))
      return request(`/api/drafts/${draftId}/files`, { method: "POST", body: form })
    },
    async close() {
      await server.close()
      await printer.close()
      await rm(dir, { recursive: true, force: true })
    },
  }
}
