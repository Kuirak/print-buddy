import { Hono } from "hono"

/**
 * The session check. Cloudflare Access sits in front of the server and answers 401 itself when the
 * login has expired, so a request that arrives here has a session. The server reads no identity.
 */
export function sessionRoutes() {
  return new Hono().get("/api/session", c => c.json({ ok: true }))
}
