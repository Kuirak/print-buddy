// Seam 3 helper: Cloudflare Access as the app meets it, without Cloudflare.
import { cleanup, screen } from "@solidjs/testing-library"
import type { UserEvent } from "@testing-library/user-event"
import { onTestFinished, vi } from "vitest"
import { handledBy } from "../share-target.ts"

/** What Cloudflare Access answers to an API call once the login has run out. The body is Cloudflare's, not the API's JSON. */
export const loginExpired = () => new Response("Unauthorized", { status: 401 })

/**
 * The person taps "Neu anmelden" and logs in. Does what the browser, Cloudflare Access and the server
 * do then: the page load takes the app away, and after the login the server sends the browser back into
 * the app. Let the API answer again before calling this, and render `<App />` afterwards to see where
 * the person lands.
 */
export async function logInAgain(user: UserEvent) {
  const pageLoad = vi.spyOn(location, "assign").mockImplementation(() => {})
  onTestFinished(() => pageLoad.mockRestore())
  await user.click(await screen.findByRole("button", { name: "Neu anmelden" }))

  const address = pageLoad.mock.lastCall?.[0]
  if (address !== "/login") throw new Error(`logInAgain: expected a page load of /login, got ${address}`)
  // from its cache the service worker would answer without Cloudflare ever seeing the request
  if (handledBy(new Request(new URL(address, location.href))) !== "network") throw new Error("logInAgain: the service worker would answer the login address itself")

  cleanup()
  // where the server sends the browser from /login (server/session.test.ts)
  history.replaceState(null, "", "/?logged-in=1")
}
