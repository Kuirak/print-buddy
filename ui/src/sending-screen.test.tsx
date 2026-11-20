import { setTimeout as sleep } from "node:timers/promises"
import { render, screen, within } from "@solidjs/testing-library"
import { userEvent, type UserEvent } from "@testing-library/user-event"
import { expect, test } from "vitest"
import type { SubmitProgress } from "../../shared/api.ts"
import { App } from "./App.tsx"
import { jobStatus, sentAt } from "./testing/job-status.ts"
import { json, mockApi } from "./testing/mock-api.ts"
import { closeDetails, openDetails, printAndConfirm, shownSettings } from "./testing/options-screen.ts"

const pdfFacts = { kind: "pdf", pageCount: 1, pages: [{ width: 595, height: 842 }] }
const accepted = () => json({ jobId: "j1", cupsJobId: 42 }, 201)

/** Picks a PDF and chooses 2 copies on the options screen. */
async function pickWithTwoCopies(user: UserEvent) {
  await user.upload(screen.getByLabelText("Datei auswählen"), new File(["%PDF-1.4"], "Rechnung.pdf", { type: "application/pdf" }))
  await openDetails(user)
  await user.click(screen.getByRole("button", { name: "Mehr Kopien" }))
  await closeDetails(user)
}

test("while the Print Job is prepared and sent, the screen says how far it has got", async () => {
  let progress: SubmitProgress | Response = json({ error: "not-found" }, 404)
  let accept!: (answer: Response) => void
  mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json(pdfFacts, 201),
    "POST /api/drafts/d1/submit": () => new Promise<Response>(resolve => { accept = resolve }),
    "GET /api/drafts/d1/progress": () => progress,
    "GET /api/jobs/j1": () => jobStatus(),
  })
  const user = userEvent.setup()
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), new File(["%PDF-1.4"], "Rechnung.pdf", { type: "application/pdf" }))

  await printAndConfirm(user)

  // before the server knows of the submit
  expect(await screen.findByRole("heading", { name: "Wird vorbereitet …" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Abbrechen" })).toBeEnabled()

  progress = { phase: "preparing", sheetsDone: 0, sheets: 3 }
  expect(await screen.findByText("Blatt 1 von 3")).toBeInTheDocument()
  expect(screen.getByRole("heading", { name: "Wird vorbereitet …" })).toBeInTheDocument()

  progress = { phase: "preparing", sheetsDone: 3, sheets: 3 }
  expect(await screen.findByText("Blatt 3 von 3")).toBeInTheDocument()

  // a read that fails says no more than that it is being prepared
  progress = json({ error: "oops" }, 500)
  await screen.findByRole("heading", { name: "Wird vorbereitet …" })
  await expect.poll(() => screen.queryByText(/^Blatt/)).toBeNull()

  progress = { phase: "sending" }
  expect(await screen.findByRole("heading", { name: "Wird an den Drucker geschickt …" })).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Abbrechen" })).not.toBeInTheDocument()
  expect(screen.queryByText(/^Blatt/)).not.toBeInTheDocument()

  accept(accepted())
  expect(await screen.findByRole("heading", { name: "Wartet" })).toBeInTheDocument()
})

test("one sheet in all says no Blatt", async () => {
  mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json(pdfFacts, 201),
    "POST /api/drafts/d1/submit": () => new Promise<Response>(() => {}),
    "GET /api/drafts/d1/progress": () => ({ phase: "preparing", sheetsDone: 0, sheets: 1 }),
  })
  const user = userEvent.setup()
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), new File(["%PDF-1.4"], "Rechnung.pdf", { type: "application/pdf" }))

  await printAndConfirm(user)

  expect(await screen.findByRole("heading", { name: "Wird vorbereitet …" })).toBeInTheDocument()
  // a poll has answered meanwhile
  await sleep(600)
  expect(screen.queryByText(/^Blatt/)).not.toBeInTheDocument()
})

test("Abbrechen while the Print Job is prepared stops it and goes back to the options screen with the Print Options just sent", async () => {
  let submits = 0
  let answerFirst!: (answer: Response) => void
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json(pdfFacts, 201),
    "POST /api/drafts/d1/submit": () => ++submits === 1 ? new Promise<Response>(resolve => { answerFirst = resolve }) : accepted(),
    "GET /api/drafts/d1/progress": () => ({ phase: "preparing", sheetsDone: 1, sheets: 4 }),
    "POST /api/drafts/d1/stop": () => {
      answerFirst(json({ error: "stopped" }, 409))
      return new Response(null, { status: 204 })
    },
    "GET /api/jobs/j1": () => jobStatus(),
  })
  const user = userEvent.setup()
  render(() => <App />)
  await pickWithTwoCopies(user)
  await printAndConfirm(user)
  await screen.findByText("Blatt 2 von 4")

  await user.click(screen.getByRole("button", { name: "Abbrechen" }))

  expect((await shownSettings(user)).copies).toBe("2")
  expect(screen.getByText("Rechnung.pdf")).toBeInTheDocument()
  expect(screen.queryByRole("heading", { name: "Drucken hat nicht geklappt" })).not.toBeInTheDocument()

  // the draft is still there: printing again sends it without a new upload
  await printAndConfirm(user)
  expect(await screen.findByRole("heading", { name: "Wartet" })).toBeInTheDocument()
  expect(api.calls.filter(call => call.method === "POST").map(call => call.path)).toEqual([
    "/api/drafts",
    "/api/drafts/d1/files",
    "/api/drafts/d1/submit",
    "/api/drafts/d1/stop",
    "/api/drafts/d1/submit",
  ])
  expect(JSON.parse(api.calls.filter(call => call.path === "/api/drafts/d1/submit")[1]!.body as string)).toMatchObject({ copies: 2 })
})

test("when Abbrechen comes too late, the Print Job is sent and the screen follows it", async () => {
  let accept!: (answer: Response) => void
  mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json(pdfFacts, 201),
    "POST /api/drafts/d1/submit": () => new Promise<Response>(resolve => { accept = resolve }),
    "GET /api/drafts/d1/progress": () => ({ phase: "preparing", sheetsDone: 0, sheets: 2 }),
    "POST /api/drafts/d1/stop": () => json({ error: "not-stoppable" }, 409),
    "GET /api/jobs/j1": () => jobStatus(),
  })
  const user = userEvent.setup()
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), new File(["%PDF-1.4"], "Rechnung.pdf", { type: "application/pdf" }))
  await printAndConfirm(user)
  await screen.findByText("Blatt 1 von 2")

  await user.click(screen.getByRole("button", { name: "Abbrechen" }))

  expect(await screen.findByRole("heading", { name: "Wird an den Drucker geschickt …" })).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Abbrechen" })).not.toBeInTheDocument()

  accept(accepted())
  expect(await screen.findByRole("heading", { name: "Wartet" })).toBeInTheDocument()
})

test("Nochmal drucken shows the upload, and Abbrechen stops it and opens the options screen with the Print Options sent before", async () => {
  let drafts = 0
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: `d${++drafts}` }, 201),
    "POST /api/drafts/d1/files": () => json(pdfFacts, 201),
    "POST /api/drafts/d1/submit": accepted,
    "GET /api/jobs/j1": () => jobStatus({ state: "done", endedAt: sentAt + 75_000 }),
    "POST /api/drafts/d2/files": () => new Promise<Response>(() => {}),
    "POST /api/drafts/d3/files": () => json(pdfFacts, 201),
  })
  const user = userEvent.setup()
  render(() => <App />)
  await pickWithTwoCopies(user)
  await printAndConfirm(user)
  await screen.findByRole("heading", { name: "Fertig" })
  await user.click(screen.getByRole("button", { name: "Nochmal drucken" }))
  await user.click(within(screen.getByRole("dialog", { name: "Nochmal drucken?" })).getByRole("button", { name: "Drucken" }))

  expect(await screen.findByRole("heading", { name: "Wird hochgeladen … 0 %" })).toBeInTheDocument()

  await user.click(screen.getByRole("button", { name: "Abbrechen" }))

  expect(api.calls.find(call => call.path === "/api/drafts/d2/files")!.signal.aborted).toBe(true)
  expect((await shownSettings(user)).copies).toBe("2")
  expect(screen.queryByRole("heading", { name: "Drucken hat nicht geklappt" })).not.toBeInTheDocument()
  expect(api.calls.filter(call => call.path.endsWith("/submit"))).toHaveLength(1)
})
