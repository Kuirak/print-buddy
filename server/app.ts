import { Hono } from "hono"
import { join } from "node:path"
import type { ApiError } from "../shared/api.ts"
import type { Now } from "./clock.ts"
import type { Config } from "./config.ts"
import { draftRoutes } from "./http/drafts.ts"
import { healthRoutes } from "./http/health.ts"
import { sessionRoutes } from "./http/session.ts"
import { uiRoutes } from "./http/ui.ts"
import { createIntake } from "./intake.ts"
import { createJobStore } from "./job-store.ts"
import { createPrinterClient } from "./printer/client.ts"

export interface AppDeps {
  config: Config
  now: Now
  /** Folder with the built UI. */
  uiDir: string
}

/** Wires the modules together. One route file per resource under `http/`; mount new ones here. */
export function createApp(deps: AppDeps) {
  const intake = createIntake({ draftsDir: join(deps.config.jobsDir, "drafts") })
  const jobs = createJobStore({ now: deps.now })
  const printer = createPrinterClient(deps.config.printerUri)

  const app = new Hono()
  app.route("/", healthRoutes())
  app.route("/", sessionRoutes())
  app.route("/", draftRoutes({ intake, jobs, printer }))
  // keep these two last: they catch what no route above answered
  app.all("/api/*", c => c.json<ApiError>({ error: "not-found" }, 404))
  app.route("/", uiRoutes({ uiDir: deps.uiDir }))
  return app
}
