import { render, screen, within } from "@solidjs/testing-library"
import { userEvent } from "@testing-library/user-event"
import { expect, onTestFinished, test, vi } from "vitest"
import type { FileFacts, PrinterInfo } from "../../shared/api.ts"
import { App } from "./App.tsx"
import { jobStatus } from "./testing/job-status.ts"
import { json, mockApi, type ApiHandler } from "./testing/mock-api.ts"
import { closeDetails, confirmation, items, openDetails, printAndConfirm } from "./testing/options-screen.ts"
import { printerInfo } from "./testing/printer-info.ts"

/** A PDF of that many A4 pages. */
const pdfOf = (pageCount: number): FileFacts => ({ kind: "pdf", pageCount, pages: Array.from({ length: pageCount }, () => ({ width: 595, height: 842 })) })

/** A landscape photo of 4000 × 3000 pixels. */
const photo: FileFacts = { kind: "photo", format: "jpeg", width: 4000, height: 3000, orientation: 1 }

/** Opens the app, picks a PDF with these facts, or `count` photos, and waits until the file is laid out. */
async function openOptions(facts: FileFacts, count = 1) {
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json(facts, 201),
    "POST /api/drafts/d1/submit": () => json({ jobId: "j1", cupsJobId: 42 }, 201),
    "GET /api/jobs/j1": () => jobStatus(),
  })
  const user = userEvent.setup({ applyAccept: false })
  render(() => <App />)
  const files = Array.from({ length: count }, (_, index) => facts.kind === "pdf"
    ? new File(["%PDF-1.4"], "Brief.pdf", { type: "application/pdf" })
    : new File(["\xff\xd8\xff"], `Strand ${index + 1}.jpg`, { type: "image/jpeg" }))
  await user.upload(screen.getByLabelText("Datei auswählen"), files)
  // the upload is done and the margins have arrived: the file is laid out from the server's facts
  await screen.findByRole("button", { name: "Drucken" })
  await screen.findByRole("status", { name: "Druckgröße in Prozent" })

  const tap = (name: string) => user.click(screen.getByRole("button", { name }))
  const choice = (group: string, name: string) => within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name })
  /** Changes detailed controls behind "Ändern" and comes back. */
  async function change(taps: () => Promise<void>) {
    await openDetails(user)
    await taps()
    await closeDetails(user)
  }
  const copies = async (count: number) => { for (let i = 1; i < count; i++) await tap("Mehr Kopien") }
  /** The one line that says everything that is chosen. */
  const summary = () => screen.getByRole("status", { name: "Gewählte Einstellungen" }).textContent
  /** The lines of the confirmation, top to bottom. */
  const lines = () => within(confirmation()).getAllByRole("listitem").map(line => line.textContent)
  const submits = () => api.calls.filter(call => call.path === "/api/drafts/d1/submit")
  return { api, user, tap, choice, change, copies, summary, lines, submits }
}

test("the summary line names everything that is chosen for a PDF", async () => {
  const { summary } = await openOptions(pdfOf(6))

  expect(summary()).toBe("1× · Farbe · A4 · Normal · Einpassen (97 %) · Mitte · 1 Seite pro Blatt · alle 6 Seiten")
})

test("the summary line follows every change", async () => {
  const { tap, user, choice, change, copies, summary } = await openOptions(pdfOf(6))

  await change(async () => {
    await copies(3)
    await user.click(choice("Farbe", "S/W"))
    await user.click(choice("Papier", "Umschlag DL"))
    await user.click(choice("Qualität", "Toner sparen"))
    await user.click(choice("Seiten pro Blatt", "2"))
  })
  await user.click(choice("Druckgröße", "100 %"))
  await user.click(choice("Position", "oben links"))
  await tap("Seite 4")

  expect(summary()).toBe("3× · S/W · Umschlag DL · Toner sparen · 100 % · oben links · 2 Seiten pro Blatt · Seiten 1-3, 5-6")

  await tap("Keine")
  expect(summary()).toContain(" · keine Seiten")
})

test.each([
  [1, "1× · Farbe · A4 · Normal · Einpassen (80 %) · Mitte · 1 Foto"],
  [3, "1× · Farbe · A4 · Normal · Einpassen (80 %) · Mitte · alle 3 Fotos"],
])("the summary line for %i photos has no pages per sheet", async (count, line) => {
  const { summary } = await openOptions(photo, count)

  expect(summary()).toBe(line)
})

test("the summary line says how many photos are left when some are left out", async () => {
  const { tap, summary } = await openOptions(photo, 3)

  await tap("Foto 2")
  expect(summary()).toContain(" · 2 von 3 Fotos")

  await tap("Keine")
  expect(summary()).toContain(" · keine Fotos")
})

test("the detailed controls are behind Ändern and go away with Fertig", async () => {
  const { user, choice } = await openOptions(pdfOf(1))
  for (const group of ["Farbe", "Papier", "Qualität", "Seiten pro Blatt"]) expect(screen.queryByRole("radiogroup", { name: group })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Mehr Kopien" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Als Voreinstellung speichern …" })).not.toBeInTheDocument()

  await openDetails(user)

  const details = within(screen.getByRole("dialog", { name: "Einstellungen" }))
  for (const group of ["Farbe", "Papier", "Qualität", "Seiten pro Blatt"]) expect(details.getByRole("radiogroup", { name: group })).toBeInTheDocument()
  expect(details.getByRole("status", { name: "Kopien" })).toHaveTextContent("1")
  expect(details.getByRole("button", { name: "Als Voreinstellung speichern …" })).toBeInTheDocument()
  expect(details.getByRole("button", { name: "★ Standard" })).toBeInTheDocument()
  expect(choice("Papier", "A4")).toBeChecked()

  await closeDetails(user)

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  expect(screen.queryByRole("radiogroup", { name: "Papier" })).not.toBeInTheDocument()
})

test("the Eigene chip opens the detailed controls", async () => {
  const { user, choice } = await openOptions(pdfOf(1))

  await user.click(choice("Voreinstellung", "Eigene …"))
  expect(screen.getByRole("dialog", { name: "Einstellungen" })).toBeInTheDocument()
  await user.click(choice("Qualität", "Toner sparen"))
  await closeDetails(user)

  await user.click(choice("Voreinstellung", "✎ Eigene"))
  expect(choice("Qualität", "Toner sparen")).toBeChecked()
})

test("Drucken opens the confirmation instead of printing, and confirming sends the Print Job", async () => {
  const { user, tap, submits } = await openOptions(pdfOf(2))

  await tap("Drucken")

  const dialog = within(confirmation())
  expect(dialog.getByRole("heading", { name: "Jetzt drucken?" })).toBeInTheDocument()
  expect(dialog.getByText("Brief.pdf")).toBeInTheDocument()
  expect(submits()).toHaveLength(0)

  await user.click(dialog.getByRole("button", { name: "Drucken" }))

  expect(await screen.findByText("Auftrag Nr. 42")).toBeInTheDocument()
  expect(submits()).toHaveLength(1)
  expect(JSON.parse(submits()[0]!.body as string)).toMatchObject({ copies: 1, items: items(1, 1) })
})

/** Opens the app and picks a one-page PDF, with `printer` answering the read of the printer info. Returns the options screen's Drucken. */
async function pickWithPrinter(printer: ApiHandler, user = userEvent.setup({ applyAccept: false })) {
  mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json(pdfOf(1), 201),
    "GET /api/printer": printer,
  })
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), new File(["%PDF-1.4"], "Brief.pdf", { type: "application/pdf" }))
  return { user, print: await screen.findByRole("button", { name: "Drucken" }) }
}

test("Drucken is not available before the printer info is there, so the confirmation never lacks its numbers", async () => {
  const info = Promise.withResolvers<PrinterInfo>()
  const { user, print } = await pickWithPrinter(() => info.promise)
  expect(print).toBeDisabled()

  info.resolve(printerInfo())

  await expect.poll(() => print).toBeEnabled()
  await user.click(print)
  expect(within(confirmation()).getAllByRole("listitem").map(line => line.textContent)).toEqual([
    "1 Seite × 1 Kopie = 1 Blatt",
    "Farbe · A4 · Einpassen (97 %)",
  ])
})

test("the printer info is read again when the read fails, so Drucken doesn't stay unavailable", async () => {
  // the clock runs by itself, and the test can skip ahead to the next read
  vi.useFakeTimers({ shouldAdvanceTime: true })
  onTestFinished(() => { vi.useRealTimers() })
  let reads = 0
  const answer = () => (++reads === 1 ? json({ error: "bad-gateway" }, 502) : printerInfo())
  const { print } = await pickWithPrinter(answer, userEvent.setup({ applyAccept: false, advanceTimers: vi.advanceTimersByTime }))
  expect(print).toBeDisabled()

  await vi.advanceTimersByTimeAsync(2_000)

  expect(print).toBeEnabled()
  expect(reads).toBe(2)
})

test("Abbrechen in the confirmation returns to the options screen with nothing changed", async () => {
  const { user, tap, choice, change, copies, summary, submits } = await openOptions(pdfOf(3))
  await change(async () => {
    await copies(2)
    await user.click(choice("Papier", "A5"))
  })
  await tap("Seite 2")
  await tap("Nächstes Blatt")
  const before = summary()

  await tap("Drucken")
  await user.click(within(confirmation()).getByRole("button", { name: "Abbrechen" }))

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  expect(submits()).toHaveLength(0)
  expect(summary()).toBe(before)
  expect(before).toBe("2× · Farbe · A5 · Normal · Einpassen (67 %) · Mitte · 1 Seite pro Blatt · Seiten 1, 3")
  expect(screen.getByRole("status", { name: "Blatt in der Vorschau" })).toHaveTextContent("Seite 3 · 2/2")
  expect(choice("Voreinstellung", "✎ Eigene")).toBeChecked()

  await printAndConfirm(user)
  expect(await screen.findByText("Auftrag Nr. 42")).toBeInTheDocument()
  expect(JSON.parse(submits()[0]!.body as string)).toMatchObject({ copies: 2, paper: "A5", items: items(1, 0, 1) })
})

// The sheet counts are the ones the server reports for the same Print Jobs: see "the sheet count is the number of
// sheets in the PDF the Printer received" in server/status.test.ts.
test.each([
  { pages: 1, leftOut: [], perSheet: "1", copies: 1, line: "1 Seite × 1 Kopie = 1 Blatt" },
  { pages: 3, leftOut: [], perSheet: "1", copies: 2, line: "3 Seiten × 2 Kopien = 6 Blätter" },
  { pages: 3, leftOut: [2], perSheet: "1", copies: 2, line: "2 Seiten (1, 3) × 2 Kopien = 4 Blätter" },
  { pages: 6, leftOut: [3, 4], perSheet: "1", copies: 1, line: "4 Seiten (1-2, 5-6) × 1 Kopie = 4 Blätter" },
  { pages: 3, leftOut: [], perSheet: "2", copies: 1, line: "3 Seiten (2 pro Blatt) × 1 Kopie = 2 Blätter" },
  { pages: 3, leftOut: [], perSheet: "2", copies: 5, line: "3 Seiten (2 pro Blatt) × 5 Kopien = 10 Blätter" },
  { pages: 2, leftOut: [], perSheet: "2", copies: 1, line: "2 Seiten (2 pro Blatt) × 1 Kopie = 1 Blatt" },
  { pages: 5, leftOut: [2], perSheet: "2", copies: 2, line: "4 Seiten (1, 3-5; 2 pro Blatt) × 2 Kopien = 4 Blätter" },
])("the confirmation for a PDF reads $line", async ({ pages, leftOut, perSheet, copies: count, line }) => {
  const { user, tap, choice, change, copies, lines } = await openOptions(pdfOf(pages))
  await change(async () => {
    await copies(count)
    await user.click(choice("Seiten pro Blatt", perSheet))
  })
  for (const page of leftOut) await tap(`Seite ${page}`)

  await tap("Drucken")

  expect(lines()[0]).toBe(line)
})

test.each([
  { photos: 1, leftOut: [], copies: 1, line: "1 Foto × 1 Kopie = 1 Blatt" },
  { photos: 2, leftOut: [], copies: 3, line: "2 Fotos × 3 Kopien = 6 Blätter" },
  { photos: 2, leftOut: [1], copies: 3, line: "1 Foto × 3 Kopien = 3 Blätter" },
  { photos: 20, leftOut: [], copies: 1, line: "20 Fotos × 1 Kopie = 20 Blätter" },
])("the confirmation for photos reads $line", async ({ photos, leftOut, copies: count, line }) => {
  const { tap, change, copies, lines } = await openOptions(photo, photos)
  await change(() => copies(count))
  for (const index of leftOut) await tap(`Foto ${index}`)

  await tap("Drucken")

  expect(lines()[0]).toBe(line)
  expect(within(confirmation()).getByText(photos === 1 ? "Strand 1.jpg" : `${photos} Fotos`)).toBeInTheDocument()
})

test("the confirmation lists colour, paper and Print size", async () => {
  const { user, tap, choice, change, lines } = await openOptions(pdfOf(1))

  await tap("Drucken")
  expect(lines()).toEqual(["1 Seite × 1 Kopie = 1 Blatt", "Farbe · A4 · Einpassen (97 %)"])
  await user.click(within(confirmation()).getByRole("button", { name: "Abbrechen" }))

  await change(async () => {
    await user.click(choice("Farbe", "S/W"))
    await user.click(choice("Papier", "Umschlag C5"))
    await user.click(choice("Qualität", "Toner sparen"))
  })
  await tap("Kleiner drucken")
  await tap("Drucken")

  expect(lines()[1]).toMatch(/^Schwarz-Weiß · Umschlag C5 · \d+ % · Toner sparen$/)
})

test("the confirmation repeats the cut-off warning when content will be cut off", async () => {
  const { user, tap, choice } = await openOptions(pdfOf(1))

  await tap("Drucken")
  expect(within(confirmation()).queryByText(/abgeschnitten/)).not.toBeInTheDocument()
  await user.click(within(confirmation()).getByRole("button", { name: "Abbrechen" }))

  await user.click(choice("Druckgröße", "Füllen"))
  expect(screen.getByRole("alert")).toHaveTextContent("Achtung: Teile des Inhalts werden abgeschnitten.")
  await tap("Drucken")

  const dialog = within(confirmation())
  expect(dialog.getByText("⚠ Teile des Inhalts werden abgeschnitten.")).toBeInTheDocument()
  expect(dialog.getAllByRole("listitem")[1]).toHaveTextContent("Farbe · A4 · Füllen (100 %)")
})

test("the confirmation warns when only a later sheet is cut off", async () => {
  // page 2 is wider than the paper at 100 %, page 1 is not
  const facts: FileFacts = { kind: "pdf", pageCount: 2, pages: [{ width: 300, height: 300 }, { width: 900, height: 300 }] }
  const { user, tap, choice } = await openOptions(facts)
  await user.click(choice("Druckgröße", "100 %"))

  await tap("Drucken")

  expect(within(confirmation()).getByText("⚠ Teile des Inhalts werden abgeschnitten.")).toBeInTheDocument()
})
