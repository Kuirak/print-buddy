import { Hono } from "hono"
import { afterLoginPath, loginPath } from "../../shared/login.ts"

/**
 * The session check and the login address. Cloudflare Access sits in front of the server: it answers
 * an API call with 401 itself when the login has expired, and it shows its login before a page load
 * gets through. So a request that arrives here has a session. The server reads no identity.
 */
export function sessionRoutes() {
  const app = new Hono()
  app.get("/api/session", c => c.json({ ok: true }))
  // "Neu anmelden" loads this address. Whoever gets this far is logged in, and goes back into the app.
  app.get(loginPath, c => c.redirect(afterLoginPath, 303))
  return app
}
