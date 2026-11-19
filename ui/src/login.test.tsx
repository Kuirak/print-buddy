import { render, screen } from "@solidjs/testing-library"
import { expect, test } from "vitest"
import { App } from "./App.tsx"
import { mockApi } from "./testing/mock-api.ts"

/** What Cloudflare Access answers to an API call once the login has run out. The body is Cloudflare's, not the API's JSON. */
const loginExpired = () => new Response("Unauthorized", { status: 401 })

test("the app asks the session check when it opens, and a 401 shows Anmeldung abgelaufen with Neu anmelden", async () => {
  const api = mockApi({ "GET /api/session": loginExpired })

  render(() => <App />)

  expect(await screen.findByRole("heading", { name: "Anmeldung abgelaufen" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Neu anmelden" })).toBeInTheDocument()
  expect(screen.queryByLabelText("Datei auswählen")).not.toBeInTheDocument()
  expect(api.calls.map(call => `${call.method} ${call.path}`)).toEqual(["GET /api/session"])
  expect(api.calls[0]!.headers.get("X-Requested-With")).toBe("XMLHttpRequest")
})
