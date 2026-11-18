import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"

/** The built UI. Anything the build does not contain is a 404, never the app's HTML. */
export function uiRoutes(deps: { uiDir: string }) {
  const app = new Hono()
  // Vite puts a content hash in every file name under /assets
  app.use("/assets/*", serveStatic({
    root: deps.uiDir,
    onFound: (_path, c) => { c.header("Cache-Control", "public, immutable, max-age=31536000") },
  }))
  // everything else is re-checked on each open, so a new version is picked up
  app.use("*", serveStatic({
    root: deps.uiDir,
    onFound: (_path, c) => { c.header("Cache-Control", "no-cache") },
  }))
  return app
}
