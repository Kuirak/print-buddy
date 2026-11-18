import { render, screen } from "@solidjs/testing-library"
import { userEvent } from "@testing-library/user-event"
import { expect, test } from "vitest"
import { App } from "./App.tsx"
import { json, mockApi } from "./testing/mock-api.ts"

test("pick a PDF, tap Drucken, and see the CUPS job number", async () => {
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json({ kind: "pdf" }, 201),
    "POST /api/drafts/d1/submit": () => json({ jobId: "j1", cupsJobId: 42 }, 201),
  })
  const user = userEvent.setup()
  const pdf = new File(["%PDF-1.4"], "Rechnung.pdf", { type: "application/pdf" })
  render(() => <App />)

  await user.upload(screen.getByLabelText("Datei auswählen"), pdf)
  expect(await screen.findByText("Rechnung.pdf")).toBeInTheDocument()

  await user.click(screen.getByRole("button", { name: "Drucken" }))
  expect(await screen.findByText("An den Drucker gesendet")).toBeInTheDocument()
  expect(screen.getByText("Auftrag Nr. 42")).toBeInTheDocument()

  expect(api.calls.map(call => `${call.method} ${call.path}`)).toEqual([
    "POST /api/drafts",
    "POST /api/drafts/d1/files",
    "POST /api/drafts/d1/submit",
  ])
  expect((api.calls[1]!.body as FormData).get("file")).toBe(pdf)
  for (const call of api.calls) expect(call.headers.get("X-Requested-With")).toBe("XMLHttpRequest")
})

test("tapping Drucken twice sends one Print Job", async () => {
  let accept!: (answer: Response) => void
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json({ kind: "pdf" }, 201),
    "POST /api/drafts/d1/submit": () => new Promise<Response>(resolve => { accept = resolve }),
  })
  const user = userEvent.setup()
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), new File(["%PDF-1.4"], "Rechnung.pdf", { type: "application/pdf" }))

  const drucken = await screen.findByRole("button", { name: "Drucken" })
  await user.click(drucken)
  await user.click(drucken)
  accept(json({ jobId: "j1", cupsJobId: 7 }, 201))

  expect(await screen.findByText("Auftrag Nr. 7")).toBeInTheDocument()
  expect(api.calls.filter(call => call.path === "/api/drafts/d1/submit")).toHaveLength(1)
})
