import { render, screen, within } from "@solidjs/testing-library"
import { userEvent } from "@testing-library/user-event"
import { expect, test } from "vitest"
import { App } from "./App.tsx"
import { jobStatus } from "./testing/job-status.ts"
import { json, mockApi } from "./testing/mock-api.ts"
import { closeDetails, openDetails, printAndConfirm } from "./testing/options-screen.ts"

/** Opens the app, picks a PDF and waits for the options screen. */
async function openOptions() {
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json({ kind: "pdf", pageCount: 1, pages: [{ width: 595, height: 842 }] }, 201),
    "POST /api/drafts/d1/submit": () => json({ jobId: "j1", cupsJobId: 42 }, 201),
    "GET /api/jobs/j1": () => jobStatus(),
  })
  const user = userEvent.setup()
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), new File(["%PDF-1.4"], "Rechnung.pdf", { type: "application/pdf" }))
  // copies, colour, paper and quality are behind "Einstellungen"
  await openDetails(user)

  /** Closes the detailed controls, taps Drucken, confirms, and returns the Print Options the app submitted. */
  async function print() {
    await closeDetails(user)
    await printAndConfirm(user)
    await screen.findByText("Auftrag Nr. 42")
    const call = api.calls.find(call => call.path === "/api/drafts/d1/submit")!
    expect(call.headers.get("Content-Type")).toBe("application/json")
    return JSON.parse(call.body as string) as Record<string, unknown>
  }
  const choice = (group: string, name: string) => within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name })
  return { user, print, choice }
}

test("a new PDF is submitted with one copy, in colour, on A4, in normal quality", async () => {
  const { print, choice } = await openOptions()

  expect(screen.getByRole("status", { name: "Kopien" })).toHaveTextContent("1")
  expect(choice("Farbe", "Farbe")).toBeChecked()
  expect(choice("Farbe", "S/W")).not.toBeChecked()
  expect(choice("Papier", "A4")).toBeChecked()
  expect(choice("Qualität", "Normal")).toBeChecked()

  expect(await print()).toEqual({
    copies: 1, color: "color", paper: "A4", quality: "normal",
    printSize: { kind: "fill" }, position: "center", layout: { kind: "grid", perSheet: 1 }, items: [{ count: 1, turn: 0 }],
  })
})

test("changing copies, colour, paper and quality changes the submitted Print Options", async () => {
  const { user, print, choice } = await openOptions()

  await user.click(screen.getByRole("button", { name: "Mehr Kopien" }))
  await user.click(screen.getByRole("button", { name: "Mehr Kopien" }))
  await user.click(choice("Farbe", "S/W"))
  await user.click(choice("Papier", "Umschlag DL"))
  await user.click(choice("Qualität", "Toner sparen"))

  expect(screen.getByRole("status", { name: "Kopien" })).toHaveTextContent("3")
  expect(choice("Farbe", "S/W")).toBeChecked()
  expect(choice("Farbe", "Farbe")).not.toBeChecked()
  expect(choice("Papier", "Umschlag DL")).toBeChecked()
  expect(choice("Papier", "A4")).not.toBeChecked()
  expect(choice("Qualität", "Toner sparen")).toBeChecked()

  expect(await print()).toMatchObject({ copies: 3, color: "mono", paper: "EnvDL", quality: "draft" })
})

test.each([
  ["A4", "A4"],
  ["A5", "A5"],
  ["Umschlag DL", "EnvDL"],
  ["Umschlag C5", "EnvC5"],
])("choosing the paper %s submits %s", async (label, paper) => {
  const { user, print, choice } = await openOptions()

  await user.click(choice("Papier", "A5"))
  await user.click(choice("Papier", label))

  expect(await print()).toMatchObject({ paper })
})

test("a choice can be changed back", async () => {
  const { user, print, choice } = await openOptions()

  await user.click(choice("Farbe", "S/W"))
  await user.click(choice("Farbe", "Farbe"))
  await user.click(choice("Qualität", "Toner sparen"))
  await user.click(choice("Qualität", "Normal"))

  expect(await print()).toMatchObject({ color: "color", quality: "normal" })
})

test("the copies never go below 1", async () => {
  const { user, print } = await openOptions()
  const fewer = screen.getByRole("button", { name: "Weniger Kopien" })
  const more = screen.getByRole("button", { name: "Mehr Kopien" })

  expect(fewer).toBeDisabled()
  await user.click(fewer)
  expect(screen.getByRole("status", { name: "Kopien" })).toHaveTextContent("1")

  await user.click(more)
  await user.click(more)
  expect(fewer).toBeEnabled()
  await user.click(fewer)
  await user.click(fewer)
  await user.click(fewer)

  expect(screen.getByRole("status", { name: "Kopien" })).toHaveTextContent("1")
  expect(await print()).toMatchObject({ copies: 1 })
})

test("the copies stop at 100", async () => {
  const { user, print } = await openOptions()
  const more = screen.getByRole("button", { name: "Mehr Kopien" })

  for (let i = 0; i < 105; i++) await user.click(more)

  expect(more).toBeDisabled()
  expect(screen.getByRole("status", { name: "Kopien" })).toHaveTextContent("100")
  expect(await print()).toMatchObject({ copies: 100 })
})
