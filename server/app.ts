import { Hono } from "hono"
import { join } from "node:path"
import type { ApiError } from "../shared/api.ts"
import type { Now } from "./clock.ts"
import type { Config } from "./config.ts"
import { draftRoutes } from "./http/drafts.ts"
import { healthRoutes } from "./http/health.ts"
import { jobRoutes } from "./http/jobs.ts"
import { sessionRoutes } from "./http/session.ts"
import { printerRoutes } from "./http/printer.ts"
import { uiRoutes } from "./http/ui.ts"
import { createIntake } from "./intake.ts"
import { openJobStore } from "./job-store.ts"
import { createPrinterClient } from "./printer/client.ts"

export interface AppDeps {
  config: Config
  now: Now
  /** Folder with the built UI. */
  uiDir: string
}

/**
 * Wires the modules together. One route file per resource under `http/`; mount new ones here.
 * Asks CUPS for the printable margins before it returns; a silent CUPS costs a few seconds, not the start.
 */
export async function createApp(deps: AppDeps) {
  const intake = createIntake({ draftsDir: join(deps.config.jobsDir, "drafts"), uploadLimitMb: deps.config.uploadLimitMb })
  const jobs = await openJobStore({ jobsDir: deps.config.jobsDir, now: deps.now })
  const printer = createPrinterClient(deps.config.printerUri)
  await printer.loadMargins()

  const app = new Hono()
  app.route("/", healthRoutes())
  app.route("/", sessionRoutes())
  app.route("/", draftRoutes({ intake, jobs, printer }))
  app.route("/", jobRoutes({ jobs, printer, now: deps.now }))
  app.route("/", printerRoutes({ printer }))
  // keep these two last: they catch what no route above answered
  app.all("/api/*", c => c.json<ApiError>({ error: "not-found" }, 404))
  app.route("/", uiRoutes({ uiDir: deps.uiDir }))
  return app
}
