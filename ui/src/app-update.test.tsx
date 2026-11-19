import { render, screen } from "@solidjs/testing-library"
import { userEvent } from "@testing-library/user-event"
import { expect, test, vi } from "vitest"
import { App } from "./App.tsx"
import { fakeServiceWorker } from "./testing/fake-service-worker.ts"
import { jobStatus, sentAt } from "./testing/job-status.ts"
import { json, mockApi } from "./testing/mock-api.ts"
import { share } from "./testing/share.ts"

const pdf = () => new File(["%PDF-1.4"], "Rechnung.pdf", { type: "application/pdf" })
const pdfRoutes = {
  "POST /api/drafts": () => json({ draftId: "d1" }, 201),
  "POST /api/drafts/d1/files": () => json({ kind: "pdf", pageCount: 1, pages: [{ width: 595, height: 842 }] }, 201),
  "POST /api/drafts/d1/submit": () => json({ jobId: "j1", cupsJobId: 42 }, 201),
  "GET /api/jobs/j1": () => jobStatus(),
}
/** Lets the app's pending promises run, to show that something did not happen. */
const settle = () => new Promise(resolve => setTimeout(resolve, 20))

test("the app registers its service worker when it opens", async () => {
  mockApi({})
  const worker = fakeServiceWorker()

  render(() => <App />)

  await expect.poll(() => worker.registered).toEqual(["/sw.js"])
})

test("a new version that waits takes over when the app opens on the Start screen, and the app reloads into it", async () => {
  mockApi({})
  const reload = vi.spyOn(location, "reload").mockImplementation(() => {})
  const worker = fakeServiceWorker({ waiting: true })

  render(() => <App />)

  await expect.poll(() => worker.messages).toEqual(["take-over"])
  expect(reload).not.toHaveBeenCalled()
  worker.takeOver()
  expect(reload).toHaveBeenCalledOnce()
})

test("a new version that finishes installing while the Start screen shows takes over", async () => {
  mockApi({})
  const worker = fakeServiceWorker()
  render(() => <App />)
  await expect.poll(() => worker.registered).toHaveLength(1)
  expect(worker.messages).toEqual([])

  worker.newVersionInstalled()

  expect(worker.messages).toEqual(["take-over"])
})

test("a new version does not take over while a job is in progress: from Datei auswählen through Drucken", async () => {
  let accept!: (answer: Response) => void
  mockApi({ ...pdfRoutes, "POST /api/drafts": () => new Promise<Response>(resolve => { accept = resolve }) })
  const reload = vi.spyOn(location, "reload").mockImplementation(() => {})
  const worker = fakeServiceWorker()
  const user = userEvent.setup()
  render(() => <App />)
  await expect.poll(() => worker.registered).toHaveLength(1)

  // the file is still on its way to the server
  await user.upload(screen.getByLabelText("Datei auswählen"), pdf())
  await expect.poll(() => accept).toBeDefined()
  worker.newVersionInstalled()
  expect(worker.messages).toEqual([])

  accept(json({ draftId: "d1" }, 201))
  await screen.findByText("Rechnung.pdf")
  worker.newVersionInstalled()
  expect(worker.messages).toEqual([])

  await user.click(screen.getByRole("button", { name: "Drucken" }))
  await screen.findByText("Auftrag Nr. 42")
  worker.newVersionInstalled()
  expect(worker.messages).toEqual([])

  // even if the new version took over, say for another window, this one keeps its job
  worker.takeOver()
  expect(reload).not.toHaveBeenCalled()
  expect(screen.getByText("Auftrag Nr. 42")).toBeInTheDocument()
})

test("a new version that waits does not take over when a share opens the app", async () => {
  mockApi(pdfRoutes)
  const worker = fakeServiceWorker({ waiting: true })

  await share([pdf()])
  render(() => <App />)

  await screen.findByText("Rechnung.pdf")
  await expect.poll(() => worker.registered).toHaveLength(1)
  await settle()
  expect(worker.messages).toEqual([])
})

test("a new version does not take over while a Refusal shows", async () => {
  mockApi({ ...pdfRoutes, "POST /api/drafts/d1/files": () => json({ refusal: "unsupported-type" }, 415) })
  const worker = fakeServiceWorker()
  const user = userEvent.setup()
  render(() => <App />)

  await user.upload(screen.getByLabelText("Datei auswählen"), pdf())
  await screen.findByText("Diese Datei kann Print Buddy nicht drucken. Möglich sind PDF, JPG und PNG.")
  worker.newVersionInstalled()

  expect(worker.messages).toEqual([])
})

test("a share that arrives without files leaves no job in progress, so a waiting version takes over", async () => {
  mockApi({})
  const worker = fakeServiceWorker({ waiting: true })

  await share([])
  render(() => <App />)

  await screen.findByLabelText("Datei auswählen")
  await expect.poll(() => worker.messages).toEqual(["take-over"])
})

test("where the service worker can't be registered, the app works without it", async () => {
  mockApi(pdfRoutes)
  const worker = fakeServiceWorker({ unavailable: true })
  const user = userEvent.setup()
  render(() => <App />)
  await expect.poll(() => worker.registered).toHaveLength(1)

  await user.upload(screen.getByLabelText("Datei auswählen"), pdf())

  expect(await screen.findByText("Rechnung.pdf")).toBeInTheDocument()
})

test("over plain HTTP there is no service worker, and Datei auswählen is the way in", async () => {
  mockApi(pdfRoutes)
  expect("serviceWorker" in navigator).toBe(false)
  const user = userEvent.setup()
  render(() => <App />)

  await user.upload(screen.getByLabelText("Datei auswählen"), pdf())
  expect(await screen.findByText("Rechnung.pdf")).toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "Drucken" }))

  expect(await screen.findByText("Auftrag Nr. 42")).toBeInTheDocument()
})

test("a new version that waited through a job takes over once the person taps Schließen", async () => {
  mockApi({ ...pdfRoutes, "GET /api/jobs/j1": () => jobStatus({ state: "done", endedAt: sentAt + 75_000 }) })
  const reload = vi.spyOn(location, "reload").mockImplementation(() => {})
  const worker = fakeServiceWorker()
  const user = userEvent.setup()
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), pdf())
  await user.click(await screen.findByRole("button", { name: "Drucken" }))
  await screen.findByRole("heading", { name: "Fertig" })
  worker.newVersionInstalled()
  expect(worker.messages).toEqual([])

  await user.click(screen.getByRole("button", { name: "Schließen" }))

  expect(screen.getByLabelText("Datei auswählen")).toBeInTheDocument()
  await expect.poll(() => worker.messages).toEqual(["take-over"])
  worker.takeOver()
  expect(reload).toHaveBeenCalledOnce()
})
