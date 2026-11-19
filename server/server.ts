import { serve } from "@hono/node-server"
import type { AddressInfo } from "node:net"
import { join } from "node:path"
import { createApp } from "./app.ts"
import type { Now } from "./clock.ts"
import type { Config } from "./config.ts"
import type { HbplEncoder } from "./printer/hbpl.ts"

export interface ServerOptions {
  now?: Now
  hostname?: string
  uiDir?: string
  encodeHbpl?: HbplEncoder
}

export interface RunningServer {
  url: string
  /** Deletes old job folders and drafts now. The server does this itself when it starts and every hour. */
  cleanup(): Promise<void>
  close(): Promise<void>
}

const cleanupEvery = 60 * 60 * 1000

/** Starts Print Buddy. `config.port` 0 picks a free port. */
export async function startServer(config: Config, opts: ServerOptions = {}): Promise<RunningServer> {
  const hostname = opts.hostname ?? "0.0.0.0"
  const app = await createApp({
    config,
    now: opts.now ?? Date.now,
    uiDir: opts.uiDir ?? join(import.meta.dirname, "..", "dist", "ui"),
    encodeHbpl: opts.encodeHbpl,
  })
  await app.cleanup()
  const hourly = setInterval(() => {
    app.cleanup().catch(err => console.warn("Cleanup failed:", err instanceof Error ? err.message : err))
  }, cleanupEvery)
  // the timer alone must not keep the process alive
  hourly.unref()
  const server = await new Promise<ReturnType<typeof serve>>(resolve => {
    const s = serve({ fetch: app.fetch, port: config.port, hostname }, () => resolve(s))
  })
  const { port } = server.address() as AddressInfo
  return {
    url: `http://${hostname === "0.0.0.0" ? "127.0.0.1" : hostname}:${port}`,
    cleanup: app.cleanup,
    close: () => new Promise<void>((resolve, reject) => {
      clearInterval(hourly)
      server.close(err => (err ? reject(err) : resolve()))
      if ("closeAllConnections" in server) server.closeAllConnections()
    }),
  }
}
