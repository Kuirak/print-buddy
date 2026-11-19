import { Hono } from "hono"
import { join } from "node:path"
import type { ApiError } from "../shared/api.ts"
import type { Now } from "./clock.ts"
import type { Config } from "./config.ts"
import { draftRoutes } from "./http/drafts.ts"
import { healthRoutes } from "./http/health.ts"
import { jobRoutes } from "./http/jobs.ts"
import { sessionRoutes } from "./http/session.ts"
import { shareTargetRoutes } from "./http/share-target.ts"
import { printerRoutes } from "./http/printer.ts"
import { reportRoutes } from "./http/report.ts"
import { uiRoutes } from "./http/ui.ts"
import { loadDellEngine } from "./dell-engine.ts"
import { createIntake } from "./intake.ts"
import { openJobStore } from "./job-store.ts"
import { createPrinterClient } from "./printer/client.ts"
import { foo2hbpl2, type HbplEncoder } from "./printer/hbpl.ts"
import type { DellPrinting } from "./renderer.ts"

export interface AppDeps {
  config: Config
  now: Now
  /** Folder with the built UI. */
  uiDir: string
  /** Packs colour photos into HBPL when Dell's engine is there; foo2hbpl2 unless a test puts something in its place. */
  encodeHbpl?: HbplEncoder
}

/**
 * Wires the modules together. One route file per resource under `http/`; mount new ones here.
 * Asks CUPS for the printable margins before it returns; a silent CUPS costs a few seconds, not the start.
 * `cleanup` deletes what is no longer kept; the caller decides when it runs.
 */
export async function createApp(deps: AppDeps) {
  const intake = createIntake({ draftsDir: join(deps.config.jobsDir, "drafts"), uploadLimitMb: deps.config.uploadLimitMb, now: deps.now })
  const jobs = await openJobStore({ jobsDir: deps.config.jobsDir, now: deps.now })
  const printer = createPrinterClient(deps.config.printerUri)
  await printer.loadMargins()
  const dell = await openDell(deps.config.dellEngineFile, deps.encodeHbpl ?? foo2hbpl2)

  const app = new Hono()
  app.route("/", healthRoutes())
  app.route("/", sessionRoutes())
  app.route("/", draftRoutes({ intake, jobs, printer, dell }))
  app.route("/", jobRoutes({ jobs, printer, now: deps.now }))
  app.route("/", printerRoutes({ printer }))
  app.route("/", reportRoutes({ printer }))
  app.route("/", shareTargetRoutes())
  // keep these two last: they catch what no route above answered
  app.all("/api/*", c => c.json<ApiError>({ error: "not-found" }, 404))
  app.route("/", uiRoutes({ uiDir: deps.uiDir }))
  return {
    fetch: app.fetch,
    async cleanup(): Promise<void> {
      await jobs.cleanup()
      await intake.cleanup()
    },
  }
}

/** Dell's engine from the share folder. A missing or broken file costs the Dell path, not the start: colour photos then go through the queue's driver. */
async function openDell(file: string, encode: HbplEncoder): Promise<DellPrinting | undefined> {
  try {
    const engine = await loadDellEngine(file)
    if (!engine) {
      console.log(`No Dell engine at ${file}: colour photos print through the CUPS queue's driver.`)
      return undefined
    }
    console.log(`Colour photos print through Dell's engine (${engine.about}).`)
    return { engine, encode }
  } catch (err) {
    console.error(`Dell's engine at ${file} can't be used, colour photos print through the CUPS queue's driver:`, err instanceof Error ? err.message : err)
    return undefined
  }
}
