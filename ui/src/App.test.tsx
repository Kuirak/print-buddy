import { render, screen, within } from "@solidjs/testing-library"
import { userEvent } from "@testing-library/user-event"
import { expect, test, vi } from "vitest"
import { App } from "./App.tsx"
import { jobStatus, sentAt } from "./testing/job-status.ts"
import { json, mockApi } from "./testing/mock-api.ts"
import { closeDetails, confirmation, openDetails, printAndConfirm } from "./testing/options-screen.ts"

test("pick a PDF, tap Drucken, and follow the Print Job on the status screen", async () => {
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json({ kind: "pdf", pageCount: 1, pages: [{ width: 595, height: 842 }] }, 201),
    "POST /api/drafts/d1/submit": () => json({ jobId: "j1", cupsJobId: 42 }, 201),
    "GET /api/jobs/j1": () => jobStatus(),
  })
  const user = userEvent.setup()
  const pdf = new File(["%PDF-1.4"], "Rechnung.pdf", { type: "application/pdf" })
  render(() => <App />)

  await user.upload(screen.getByLabelText("Datei auswählen"), pdf)
  expect(await screen.findByText("Rechnung.pdf")).toBeInTheDocument()

  await printAndConfirm(user)
  expect(await screen.findByRole("heading", { name: "Wartet" })).toBeInTheDocument()
  expect(screen.getByText("Auftrag Nr. 42")).toBeInTheDocument()

  expect(api.calls.filter(call => call.method === "POST").map(call => call.path)).toEqual([
    "/api/drafts",
    "/api/drafts/d1/files",
    "/api/drafts/d1/submit",
  ])
  expect((api.calls.find(call => call.path === "/api/drafts/d1/files")!.body as FormData).get("file")).toBe(pdf)
  for (const call of api.calls) expect(call.headers.get("X-Requested-With")).toBe("XMLHttpRequest")
})

test("tapping Drucken twice sends one Print Job", async () => {
  let accept!: (answer: Response) => void
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json({ kind: "pdf", pageCount: 1, pages: [{ width: 595, height: 842 }] }, 201),
    "POST /api/drafts/d1/submit": () => new Promise<Response>(resolve => { accept = resolve }),
    "GET /api/jobs/j1": () => jobStatus({ cupsJobId: 7 }),
  })
  const user = userEvent.setup()
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), new File(["%PDF-1.4"], "Rechnung.pdf", { type: "application/pdf" }))

  await user.click(await screen.findByRole("button", { name: "Drucken" }))
  const drucken = within(confirmation()).getByRole("button", { name: "Drucken" })
  await user.click(drucken)
  await user.click(drucken)
  accept(json({ jobId: "j1", cupsJobId: 7 }, 201))

  expect(await screen.findByText("Auftrag Nr. 7")).toBeInTheDocument()
  expect(api.calls.filter(call => call.path === "/api/drafts/d1/submit")).toHaveLength(1)
})

test("Schließen on Fertig leads back to Start", async () => {
  mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json({ kind: "pdf", pageCount: 1, pages: [{ width: 595, height: 842 }] }, 201),
    "POST /api/drafts/d1/submit": () => json({ jobId: "j1", cupsJobId: 42 }, 201),
    "GET /api/jobs/j1": () => jobStatus({ state: "done", endedAt: sentAt + 75_000 }),
  })
  const user = userEvent.setup()
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), new File(["%PDF-1.4"], "Rechnung.pdf", { type: "application/pdf" }))
  await printAndConfirm(user)
  expect(await screen.findByRole("heading", { name: "Fertig" })).toBeInTheDocument()

  await user.click(screen.getByRole("button", { name: "Schließen" }))

  expect(screen.getByLabelText("Datei auswählen")).toBeInTheDocument()
  expect(screen.queryByRole("heading", { name: "Fertig" })).not.toBeInTheDocument()
})

test("Nochmal drucken on Fertig sends the same file with the same Print Options as a new Print Job", async () => {
  let drafts = 0
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: `d${++drafts}` }, 201),
    "POST /api/drafts/d1/files": () => json({ kind: "pdf", pageCount: 1, pages: [{ width: 595, height: 842 }] }, 201),
    "POST /api/drafts/d1/submit": () => json({ jobId: "j1", cupsJobId: 42 }, 201),
    "GET /api/jobs/j1": () => jobStatus({ state: "done", endedAt: sentAt + 75_000 }),
    "POST /api/drafts/d2/files": () => json({ kind: "pdf", pageCount: 1, pages: [{ width: 595, height: 842 }] }, 201),
    "POST /api/drafts/d2/submit": () => json({ jobId: "j2", cupsJobId: 43 }, 201),
    "GET /api/jobs/j2": () => jobStatus({ jobId: "j2", cupsJobId: 43 }),
  })
  const user = userEvent.setup()
  const pdf = new File(["%PDF-1.4"], "Rechnung.pdf", { type: "application/pdf" })
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), pdf)
  await openDetails(user)
  await user.click(screen.getByRole("button", { name: "Mehr Kopien" }))
  await user.click(within(screen.getByRole("radiogroup", { name: "Farbe" })).getByRole("radio", { name: "Farbe" }))
  await closeDetails(user)
  await printAndConfirm(user)
  expect(await screen.findByRole("heading", { name: "Fertig" })).toBeInTheDocument()
  expect(screen.getByText("gedauert 1:15")).toBeInTheDocument()

  await user.click(screen.getByRole("button", { name: "Nochmal drucken" }))

  expect(await screen.findByText("Auftrag Nr. 43")).toBeInTheDocument()
  expect(screen.getByRole("heading", { name: "Wartet" })).toBeInTheDocument()
  expect(screen.getByText("läuft seit 0:00")).toBeInTheDocument()
  expect(api.calls.filter(call => call.method === "POST").map(call => call.path)).toEqual([
    "/api/drafts",
    "/api/drafts/d1/files",
    "/api/drafts/d1/submit",
    "/api/drafts",
    "/api/drafts/d2/files",
    "/api/drafts/d2/submit",
  ])
  const again = api.calls.find(call => call.path === "/api/drafts/d2/files")!
  expect((again.body as FormData).get("file")).toBe(pdf)
  const sent = { copies: 2, color: "color", paper: "A4", quality: "normal", printSize: { kind: "fit" }, position: "center", pagesPerSheet: 1, rotation: 0, selection: [1] }
  for (const draft of ["d1", "d2"]) {
    const submit = api.calls.find(call => call.path === `/api/drafts/${draft}/submit`)!
    expect(JSON.parse(submit.body as string)).toEqual(sent)
  }
})

const photoFacts = { kind: "photo", format: "jpeg", width: 4000, height: 3000, orientation: 1 }
const photo = (name: string) => new File(["\xff\xd8\xff"], name, { type: "image/jpeg" })

test("Datei auswählen offers PDF, JPG and PNG and allows several files", () => {
  mockApi({})
  render(() => <App />)

  const input = screen.getByLabelText<HTMLInputElement>("Datei auswählen")

  expect(input.accept.split(",")).toEqual(["application/pdf", "image/jpeg", "image/png"])
  expect(input.multiple).toBe(true)
})

test("picked photos are uploaded one per request in the order they were picked, and show up by count", async () => {
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json(photoFacts, 201),
  })
  const user = userEvent.setup()
  const picked = [photo("IMG_3.jpg"), photo("IMG_1.jpg"), photo("IMG_2.jpg")]
  render(() => <App />)

  await user.upload(screen.getByLabelText("Datei auswählen"), picked)

  expect(await screen.findByText("3 Fotos")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Drucken" })).toBeInTheDocument()
  const uploads = api.calls.filter(call => call.path === "/api/drafts/d1/files")
  expect(uploads.map(call => (call.body as FormData).getAll("file"))).toEqual([[picked[0]], [picked[1]], [picked[2]]])
})

test.each([
  [{ refusal: "unsupported-type" }, 415, "Diese Datei kann Print Buddy nicht drucken. Möglich sind PDF, JPG und PNG."],
  [{ refusal: "too-large", limitMb: 50 }, 413, "Die Datei ist zu groß (höchstens 50 MB)."],
  [{ refusal: "too-large", limitMb: 8 }, 413, "Die Datei ist zu groß (höchstens 8 MB)."],
  [{ refusal: "too-many-photos" }, 409, "Höchstens 20 Fotos auf einmal"],
  [{ refusal: "one-pdf-only" }, 409, "Bitte jeweils nur eine Datei teilen"],
  [{ refusal: "mixed-types" }, 409, "Bitte PDF und Fotos getrennt teilen"],
])("a refused file (%o) leads to the Refusal screen with its message", async (refusal, status, message) => {
  mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json(refusal, status),
  })
  const user = userEvent.setup()
  render(() => <App />)

  await user.upload(screen.getByLabelText("Datei auswählen"), photo("IMG_1.jpg"))

  expect(await screen.findByText(message)).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Drucken" })).not.toBeInTheDocument()
})

test("after a refusal nothing more is uploaded, and Datei auswählen on the Refusal screen starts over", async () => {
  let uploads = 0
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => (++uploads === 2 ? json({ refusal: "mixed-types" }, 409) : json(photoFacts, 201)),
    "POST /api/drafts/d2/files": () => json({ kind: "pdf", pageCount: 1, pages: [{ width: 595, height: 842 }] }, 201),
  })
  const user = userEvent.setup()
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), [
    photo("IMG_1.jpg"),
    new File(["%PDF-1.4"], "Rechnung.pdf", { type: "application/pdf" }),
    photo("IMG_2.jpg"),
  ])
  await screen.findByText("Bitte PDF und Fotos getrennt teilen")
  expect(api.calls.filter(call => call.path === "/api/drafts/d1/files")).toHaveLength(2)

  api.on("POST /api/drafts", () => json({ draftId: "d2" }, 201))
  await user.upload(screen.getByLabelText("Datei auswählen"), new File(["%PDF-1.4"], "Rechnung.pdf", { type: "application/pdf" }))

  expect(await screen.findByText("Rechnung.pdf")).toBeInTheDocument()
  expect(await screen.findByRole("button", { name: "Drucken" })).toBeInTheDocument()
})

test("Drucken submits every page of the PDF", async () => {
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json({ kind: "pdf", pageCount: 3, pages: [{ width: 595, height: 842 }, { width: 595, height: 842 }, { width: 842, height: 595 }] }, 201),
    "POST /api/drafts/d1/submit": () => json({ jobId: "j1", cupsJobId: 42 }, 201),
    "GET /api/jobs/j1": () => jobStatus(),
  })
  const user = userEvent.setup()
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), new File(["%PDF-1.4"], "Rechnung.pdf", { type: "application/pdf" }))

  await printAndConfirm(user)

  await screen.findByText("Auftrag Nr. 42")
  const submitted = JSON.parse(api.calls.find(call => call.path === "/api/drafts/d1/submit")!.body as string) as { selection: number[] }
  expect(submitted.selection).toEqual([1, 2, 3])
})

test("Drucken submits every picked photo, in the order they were picked", async () => {
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json(photoFacts, 201),
    "POST /api/drafts/d1/submit": () => json({ jobId: "j1", cupsJobId: 42 }, 201),
    "GET /api/jobs/j1": () => jobStatus(),
  })
  const user = userEvent.setup()
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), [photo("IMG_3.jpg"), photo("IMG_1.jpg"), photo("IMG_2.jpg")])

  await printAndConfirm(user)

  await screen.findByText("Auftrag Nr. 42")
  const submitted = JSON.parse(api.calls.find(call => call.path === "/api/drafts/d1/submit")!.body as string) as { selection: number[] }
  expect(submitted.selection).toEqual([0, 1, 2])
})

test("when sending fails, Drucken hat nicht geklappt offers Erneut versuchen, which sends the same file with the same Print Options", async () => {
  let drafts = 0
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: `d${++drafts}` }, 201),
    "POST /api/drafts/d1/files": () => json({ kind: "pdf", pageCount: 1, pages: [{ width: 595, height: 842 }] }, 201),
    "POST /api/drafts/d1/submit": () => json({ error: "cups-unreachable" }, 502),
    "POST /api/drafts/d2/files": () => json({ kind: "pdf", pageCount: 1, pages: [{ width: 595, height: 842 }] }, 201),
    "POST /api/drafts/d2/submit": () => json({ error: "cups-rejected" }, 502),
    "POST /api/drafts/d3/files": () => json({ kind: "pdf", pageCount: 1, pages: [{ width: 595, height: 842 }] }, 201),
    "POST /api/drafts/d3/submit": () => json({ jobId: "j1", cupsJobId: 42 }, 201),
    "GET /api/jobs/j1": () => jobStatus(),
  })
  const user = userEvent.setup()
  const pdf = new File(["%PDF-1.4"], "Rechnung.pdf", { type: "application/pdf" })
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), pdf)
  await openDetails(user)
  await user.click(screen.getByRole("button", { name: "Mehr Kopien" }))
  await user.click(within(screen.getByRole("radiogroup", { name: "Farbe" })).getByRole("radio", { name: "Farbe" }))
  await closeDetails(user)

  await printAndConfirm(user)

  expect(await screen.findByRole("heading", { name: "Drucken hat nicht geklappt" })).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Drucken" })).not.toBeInTheDocument()

  // a second failure leaves the person where they were
  await user.click(screen.getByRole("button", { name: "Erneut versuchen" }))
  await vi.waitFor(() => expect(api.calls.some(call => call.path === "/api/drafts/d2/submit")).toBe(true))
  expect(await screen.findByRole("heading", { name: "Drucken hat nicht geklappt" })).toBeInTheDocument()

  await user.click(screen.getByRole("button", { name: "Erneut versuchen" }))

  expect(await screen.findByRole("heading", { name: "Wartet" })).toBeInTheDocument()
  expect(screen.getByText("Auftrag Nr. 42")).toBeInTheDocument()
  const sent = { copies: 2, color: "color", paper: "A4", quality: "normal", printSize: { kind: "fit" }, position: "center", pagesPerSheet: 1, rotation: 0, selection: [1] }
  for (const draft of ["d1", "d2", "d3"]) {
    const upload = api.calls.find(call => call.path === `/api/drafts/${draft}/files`)!
    expect((upload.body as FormData).get("file")).toBe(pdf)
    const submit = api.calls.find(call => call.path === `/api/drafts/${draft}/submit`)!
    expect(JSON.parse(submit.body as string)).toEqual(sent)
  }
})

test("when the server can't be reached at all, Drucken hat nicht geklappt keeps every photo for Erneut versuchen", async () => {
  let drafts = 0
  let online = false
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: `d${++drafts}` }, 201),
    "POST /api/drafts/d1/files": () => json(photoFacts, 201),
    "POST /api/drafts/d1/submit": () => { throw new TypeError("Failed to fetch") },
    "POST /api/drafts/d2/files": () => {
      if (!online) throw new TypeError("Failed to fetch")
      return json(photoFacts, 201)
    },
    "POST /api/drafts/d3/files": () => json(photoFacts, 201),
    "POST /api/drafts/d3/submit": () => json({ jobId: "j1", cupsJobId: 42 }, 201),
    "GET /api/jobs/j1": () => jobStatus(),
  })
  const user = userEvent.setup()
  const photos = [photo("a.jpg"), photo("b.jpg")]
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), photos)
  await printAndConfirm(user)
  expect(await screen.findByRole("heading", { name: "Drucken hat nicht geklappt" })).toBeInTheDocument()

  // still offline: the upload of the retry fails too
  await user.click(screen.getByRole("button", { name: "Erneut versuchen" }))
  await vi.waitFor(() => expect(api.calls.some(call => call.path === "/api/drafts/d2/files")).toBe(true))
  expect(await screen.findByRole("heading", { name: "Drucken hat nicht geklappt" })).toBeInTheDocument()

  online = true
  await user.click(screen.getByRole("button", { name: "Erneut versuchen" }))

  expect(await screen.findByRole("heading", { name: "Wartet" })).toBeInTheDocument()
  const uploaded = api.calls.filter(call => call.path === "/api/drafts/d3/files").map(call => (call.body as FormData).get("file"))
  expect(uploaded).toEqual(photos)
})
