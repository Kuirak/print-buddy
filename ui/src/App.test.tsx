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

  expect(api.calls.filter(call => call.method === "POST").map(call => call.path)).toEqual([
    "/api/drafts",
    "/api/drafts/d1/files",
    "/api/drafts/d1/submit",
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
  [{ refusal: "mixed-types" }, 409, "Bitte jeweils nur eine Datei teilen"],
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
  await screen.findByText("Bitte jeweils nur eine Datei teilen")
  expect(api.calls.filter(call => call.path === "/api/drafts/d1/files")).toHaveLength(2)

  api.on("POST /api/drafts", () => json({ draftId: "d2" }, 201))
  await user.upload(screen.getByLabelText("Datei auswählen"), new File(["%PDF-1.4"], "Rechnung.pdf", { type: "application/pdf" }))

  expect(await screen.findByText("Rechnung.pdf")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Drucken" })).toBeInTheDocument()
})
