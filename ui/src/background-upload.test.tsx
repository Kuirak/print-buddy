import { render, screen, within } from "@solidjs/testing-library"
import { userEvent } from "@testing-library/user-event"
import { expect, test } from "vitest"
import { App } from "./App.tsx"
import { phoneFiles } from "./phone-files.ts"
import { jpegFile, pdfFile } from "./testing/files.ts"
import { jobStatus } from "./testing/job-status.ts"
import { logInAgain, loginExpired } from "./testing/login.ts"
import { json, mockApi, type ApiCall } from "./testing/mock-api.ts"
import { closeDetails, confirmation, openDetails, printAndConfirm, shownSettings } from "./testing/options-screen.ts"
import { share } from "./testing/share.ts"

const a4 = { width: 595, height: 842 }
const pdfFacts = { kind: "pdf", pageCount: 1, pages: [a4] }
const photoFacts = (width: number, height: number) => ({ kind: "photo", format: "jpeg", width, height, orientation: 1 })

/** An answer the test sends when it wants to: the upload of that file is on its way until then. */
function heldAnswer() {
  const { promise, resolve } = Promise.withResolvers<Response>()
  return { answer: () => promise, send: resolve }
}

/** The Drucken button, whatever it says while the upload runs. */
const printButton = () => screen.getByRole("button", { name: /^(Drucken|Wird hochgeladen)/ })
const uploads = (calls: ApiCall[]) => calls.filter(call => call.path.endsWith("/files"))

test("a picked PDF opens the options screen with its preview while the upload runs; Drucken waits for the upload", async () => {
  const upload = heldAnswer()
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": upload.answer,
    "POST /api/drafts/d1/submit": () => json({ jobId: "j1", cupsJobId: 42 }, 201),
    "GET /api/jobs/j1": () => jobStatus(),
  })
  const user = userEvent.setup()
  render(() => <App />)

  await user.upload(screen.getByLabelText("Datei auswählen"), pdfFile("Rechnung.pdf", [a4, a4]))

  // laid out from what the browser read: two A4 pages, each at 100 % to fill the sheet
  expect(await screen.findByRole("status", { name: "Druckgröße in Prozent" })).toHaveTextContent("100 %")
  expect(screen.getByRole("status", { name: "Blatt in der Vorschau" })).toHaveTextContent("Seite 1 · 1/2")
  expect(screen.getByRole("button", { name: "Seite 2" })).toBeInTheDocument()
  expect(printButton()).toHaveTextContent("Wird hochgeladen … 0 %")
  expect(printButton()).toBeDisabled()
  expect(uploads(api.calls)).toHaveLength(1)

  upload.send(json({ kind: "pdf", pageCount: 2, pages: [a4, a4] }, 201))

  await expect.poll(() => printButton()).toHaveTextContent("Drucken")
  expect(printButton()).toBeEnabled()
  await printAndConfirm(user)
  expect(await screen.findByText("Auftrag Nr. 42")).toBeInTheDocument()
})

test("photos upload one by one in their order, and Drucken shows the share of all their bytes on the server", async () => {
  const second = heldAnswer()
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": call => ((call.body as FormData).get("file") as File).name === "Strand 1.jpg"
      ? json(photoFacts(4000, 3000), 201)
      : second.answer(),
  })
  const user = userEvent.setup()
  render(() => <App />)

  await user.upload(screen.getByLabelText("Datei auswählen"), [jpegFile("Strand 1.jpg", 4000, 3000, 600), jpegFile("Strand 2.jpg", 3000, 4000, 400)])

  expect(await screen.findByText("2 Fotos")).toBeInTheDocument()
  expect(await screen.findByRole("status", { name: "Blatt in der Vorschau" })).toHaveTextContent("Foto 1/2")
  await expect.poll(() => printButton()).toHaveTextContent("Wird hochgeladen … 60 %")
  expect(uploads(api.calls).map(call => ((call.body as FormData).get("file") as File).name)).toEqual(["Strand 1.jpg", "Strand 2.jpg"])

  second.send(json(photoFacts(3000, 4000), 201))

  await expect.poll(() => printButton()).toHaveTextContent("Drucken")
})

test("a shared file opens the options screen while its upload runs", async () => {
  const upload = heldAnswer()
  mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": upload.answer,
  })

  await share([pdfFile("Rechnung.pdf")])
  render(() => <App />)

  expect(await screen.findByText("Rechnung.pdf")).toBeInTheDocument()
  expect(await screen.findByRole("status", { name: "Druckgröße in Prozent" })).toHaveTextContent("100 %")
  expect(printButton()).toHaveTextContent("Wird hochgeladen … 0 %")
})

test("a refusal that arrives after the options screen opened shows the Refusal screen", async () => {
  const upload = heldAnswer()
  mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": upload.answer,
  })
  const user = userEvent.setup()
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), pdfFile("Riesig.pdf"))
  await screen.findByText("Riesig.pdf")

  upload.send(json({ refusal: "too-large", limitMb: 50 }, 413))

  expect(await screen.findByText("Die Datei ist zu groß (höchstens 50 MB).")).toBeInTheDocument()
  expect(screen.queryByText("Riesig.pdf")).not.toBeInTheDocument()
  expect(await phoneFiles.held()).toEqual([])
})

test("Zurück stops the upload and goes back to Start, and the phone's copy is gone", async () => {
  const upload = heldAnswer()
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": upload.answer,
  })
  const user = userEvent.setup()
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), pdfFile("Rechnung.pdf"))
  await screen.findByText("Rechnung.pdf")

  await user.click(screen.getByRole("button", { name: "Zurück" }))

  expect(await screen.findByLabelText("Datei auswählen")).toBeInTheDocument()
  expect(uploads(api.calls)[0]!.signal.aborted).toBe(true)
  expect(screen.queryByText("Rechnung.pdf")).not.toBeInTheDocument()
  expect(await phoneFiles.held()).toEqual([])

  // an answer that comes all the same changes nothing
  upload.send(json({ refusal: "unsupported-type" }, 415))
  await new Promise(resolve => setTimeout(resolve, 10))
  expect(screen.getByLabelText("Datei auswählen")).toBeInTheDocument()
})

test("once the upload is done, the server's facts count: the confirmation and the thumbnails follow them", async () => {
  mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    // the browser read one page; the server, which decides, finds three
    "POST /api/drafts/d1/files": () => json({ kind: "pdf", pageCount: 3, pages: [a4, a4, a4] }, 201),
  })
  const user = userEvent.setup()
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), pdfFile("Rechnung.pdf", [a4]))

  await user.click(await screen.findByRole("button", { name: "Drucken" }))

  expect(within(confirmation()).getByRole("status", { name: "Blätter insgesamt" })).toHaveTextContent("3")
  expect(screen.getByRole("button", { name: "Seite 3" })).toBeInTheDocument()
})

test("a file the browser can't read opens the options screen once the server has read it", async () => {
  mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json(photoFacts(4000, 3000), 201),
  })
  const user = userEvent.setup()
  render(() => <App />)

  // the photo's head isn't one the browser knows; the server reads it all the same
  await user.upload(screen.getByLabelText("Datei auswählen"), new File(["not a JPEG head"], "Strand.jpg", { type: "image/jpeg" }))

  await screen.findByRole("button", { name: "Drucken" })
  await expect.poll(() => printButton()).toBeEnabled()
  expect(screen.getByText("Strand.jpg")).toBeInTheDocument()
})

test("a 401 during the upload shows Anmeldung abgelaufen, and after the login the options screen has what the person chose", async () => {
  const upload = heldAnswer()
  mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": upload.answer,
  })
  const user = userEvent.setup()
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), pdfFile("Rechnung.pdf"))
  await openDetails(user)
  await user.click(screen.getByRole("button", { name: "Mehr Kopien" }))
  await closeDetails(user)

  upload.send(loginExpired())

  expect(await screen.findByRole("heading", { name: "Anmeldung abgelaufen" })).toBeInTheDocument()
  mockApi({
    "POST /api/drafts": () => json({ draftId: "d2" }, 201),
    "POST /api/drafts/d2/files": () => json(pdfFacts, 201),
  })
  await logInAgain(user)
  render(() => <App />)
  expect((await shownSettings(user)).copies).toBe("2")
})

test("an upload that gets no answer shows Drucken hat nicht geklappt, and Erneut versuchen opens the options screen again", async () => {
  let drafts = 0
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: `d${++drafts}` }, 201),
    "POST /api/drafts/d1/files": () => { throw new TypeError("Failed to fetch") },
    "POST /api/drafts/d2/files": () => json(pdfFacts, 201),
  })
  const user = userEvent.setup()
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), pdfFile("Rechnung.pdf"))

  await user.click(await screen.findByRole("button", { name: "Erneut versuchen" }))

  expect(await screen.findByText("Rechnung.pdf")).toBeInTheDocument()
  await expect.poll(() => printButton()).toHaveTextContent("Drucken")
  expect(api.calls.some(call => call.path === "/api/drafts/d2/submit")).toBe(false)
})
