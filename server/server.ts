import { serve } from "@hono/node-server"
import type { AddressInfo } from "node:net"
import { join } from "node:path"
import { createApp } from "./app.ts"
import type { Now } from "./clock.ts"
import type { Config } from "./config.ts"

export interface ServerOptions {
  now?: Now
  hostname?: string
  uiDir?: string
}

export interface RunningServer {
  url: string
  close(): Promise<void>
}

/** Starts Print Buddy. `config.port` 0 picks a free port. */
export async function startServer(config: Config, opts: ServerOptions = {}): Promise<RunningServer> {
  const hostname = opts.hostname ?? "0.0.0.0"
  const app = await createApp({
    config,
    now: opts.now ?? Date.now,
    uiDir: opts.uiDir ?? join(import.meta.dirname, "..", "dist", "ui"),
  })
  const server = await new Promise<ReturnType<typeof serve>>(resolve => {
    const s = serve({ fetch: app.fetch, port: config.port, hostname }, () => resolve(s))
  })
  const { port } = server.address() as AddressInfo
  return {
    url: `http://${hostname === "0.0.0.0" ? "127.0.0.1" : hostname}:${port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(err => (err ? reject(err) : resolve()))
      if ("closeAllConnections" in server) server.closeAllConnections()
    }),
  }
}
