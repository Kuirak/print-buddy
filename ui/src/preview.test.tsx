import { render, screen, within } from "@solidjs/testing-library"
import { userEvent } from "@testing-library/user-event"
import { expect, test } from "vitest"
import { App } from "./App.tsx"
import { json, mockApi, type ApiHandler } from "./testing/mock-api.ts"

/** Two pages of US Letter: a little wider and a little shorter than A4 (595 × 842 pt). */
const letterPdf = { kind: "pdf", pageCount: 2, pages: [{ width: 612, height: 792 }, { width: 612, height: 792 }] }

/** Opens the app, picks a file with these facts and waits for the options screen. */
async function openOptions(facts: { kind: string } = letterPdf, routes: Record<string, ApiHandler> = {}) {
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json(facts, 201),
    "POST /api/drafts/d1/submit": () => json({ jobId: "j1", cupsJobId: 42 }, 201),
    ...routes,
  })
  const user = userEvent.setup({ applyAccept: false })
  render(() => <App />)
  const file = facts.kind === "pdf"
    ? new File(["%PDF-1.4"], "Brief.pdf", { type: "application/pdf" })
    : new File(["\xff\xd8\xff"], "Strand.jpg", { type: "image/jpeg" })
  await user.upload(screen.getByLabelText("Datei auswählen"), file)
  await screen.findByRole("button", { name: "Drucken" })

  /** Taps Drucken and returns the Print Options the app submitted. */
  async function print() {
    await user.click(screen.getByRole("button", { name: "Drucken" }))
    await screen.findByText("Auftrag Nr. 42")
    return JSON.parse(api.calls.find(call => call.path === "/api/drafts/d1/submit")!.body as string) as Record<string, unknown>
  }
  const choice = (group: string, name: string) => within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name })
  const tap = (name: string) => user.click(screen.getByRole("button", { name }))
  /** The percentage the Print size row shows. */
  const percent = () => screen.findByRole("status", { name: "Druckgröße in Prozent" })
  return { api, user, file, print, choice, tap, percent }
}

test("a new file starts at Einpassen, and the Print size row shows the percentage that gives", async () => {
  const { choice, percent, print } = await openOptions()

  // the printable width of A4 is 595.28 − 2 × 9 = 577.28 pt, and 577.28 / 612 = 0.943
  expect(await percent()).toHaveTextContent("94 %")
  expect(choice("Druckgröße", "Einpassen")).toBeChecked()
  expect(choice("Druckgröße", "Füllen")).not.toBeChecked()
  expect(choice("Druckgröße", "100 %")).not.toBeChecked()
  expect(await print()).toMatchObject({ printSize: { kind: "fit" } })
})
