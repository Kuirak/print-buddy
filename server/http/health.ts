import { Hono } from "hono"
import { version } from "../version.ts"

/** For the HA watchdog. Must not depend on CUPS: a sleeping Printer is no reason to restart Print Buddy. */
export function healthRoutes() {
  return new Hono().get("/health", c => c.json({ ok: true, version }))
}
