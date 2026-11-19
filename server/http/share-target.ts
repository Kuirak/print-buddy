import { Hono } from "hono"
import { afterLostSharePath, shareTargetPath } from "../../shared/share-target.ts"

/**
 * The share target, for the times the app's service worker did not answer it. The service worker
 * normally takes the share POST on the phone, so it never comes here. When it does (no service worker
 * yet, or back from the Cloudflare Access login, which returns with a GET), the files are not kept:
 * the browser is sent into the app with the word that the share was lost. The phone may still hold
 * the files of an earlier job, so the app can't tell by looking at its copy.
 */
export function shareTargetRoutes() {
  const app = new Hono()
  app.all(shareTargetPath, c => c.redirect(afterLostSharePath, 303))
  return app
}
