import { render, screen } from "@solidjs/testing-library"
import { userEvent } from "@testing-library/user-event"
import { expect, test } from "vitest"
import { App } from "./App.tsx"
import { json, mockApi } from "./testing/mock-api.ts"

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

const pdfFacts = { kind: "pdf", pageCount: 1, pages: [{ width: 595, height: 842 }] }
const pdf = (name: string) => new File(["%PDF-1.4 ", name], name, { type: "application/pdf" })

test("a 401 while a picked file is on its way to the server shows Anmeldung abgelaufen", async () => {
  mockApi({ "POST /api/drafts": loginExpired })
  const user = userEvent.setup()
  render(() => <App />)

  await user.upload(screen.getByLabelText("Datei auswählen"), pdf("Rechnung.pdf"))

  expect(await screen.findByRole("heading", { name: "Anmeldung abgelaufen" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Neu anmelden" })).toBeInTheDocument()
})

test("a 401 when the person taps Drucken shows Anmeldung abgelaufen, not Drucken hat nicht geklappt", async () => {
  mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json(pdfFacts, 201),
    "POST /api/drafts/d1/submit": loginExpired,
  })
  const user = userEvent.setup()
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), pdf("Rechnung.pdf"))

  await user.click(await screen.findByRole("button", { name: "Drucken" }))

  expect(await screen.findByRole("heading", { name: "Anmeldung abgelaufen" })).toBeInTheDocument()
  expect(screen.queryByRole("heading", { name: "Drucken hat nicht geklappt" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Erneut versuchen" })).not.toBeInTheDocument()
})
