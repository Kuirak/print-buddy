import { Hono } from "hono"
import type { Now } from "./clock.ts"
import type { Config } from "./config.ts"
import { healthRoutes } from "./http/health.ts"

export interface AppDeps {
  config: Config
  now: Now
  /** Folder with the built UI. */
  uiDir: string
}

/** Wires the modules together. One route file per resource under `http/`; mount new ones here. */
export function createApp(_deps: AppDeps) {
  const app = new Hono()
  app.route("/", healthRoutes())
  return app
}
