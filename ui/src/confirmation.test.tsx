import { cleanup, render, screen, within } from "@solidjs/testing-library"
import { userEvent } from "@testing-library/user-event"
import { expect, onTestFinished, test, vi } from "vitest"
import type { FileFacts, PrinterInfo } from "../../shared/api.ts"
import { SHEET_SIZES } from "../../shared/layout.ts"
import { App } from "./App.tsx"
import { Confirmation } from "./controls/Confirmation.tsx"
import { jobStatus } from "./testing/job-status.ts"
import { json, mockApi, type ApiHandler } from "./testing/mock-api.ts"
import { closeDetails, confirmation, items, laidOut, openDetails, printAndConfirm, shownSettings } from "./testing/options-screen.ts"
import { printerInfo } from "./testing/printer-info.ts"

/** A PDF of that many A4 pages. */
const pdfOf = (pageCount: number): FileFacts => ({ kind: "pdf", pageCount, pages: Array.from({ length: pageCount }, () => ({ width: 595, height: 842 })) })

/** A PDF of one A4 page whose ink lies in these points from the page's top-left. */
const pdfWithContent = (content: { left: number, top: number, right: number, bottom: number }): FileFacts =>
  ({ kind: "pdf", pageCount: 1, pages: [{ width: 595, height: 842, content }] })

/** Ink well inside the printable area of A4 at the printer's margins. */
const inkInside = { left: 30, top: 30, right: 565, bottom: 812 }

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
  await laidOut()

  const tap = (name: string) => user.click(screen.getByRole("button", { name }))
  const choice = (group: string, name: string) => within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name })
  /** Changes detailed controls behind "Einstellungen" and comes back. */
  async function change(taps: () => Promise<void>) {
    await openDetails(user)
    await taps()
    await closeDetails(user)
  }
  const copies = async (count: number) => { for (let i = 1; i < count; i++) await tap("Mehr Kopien") }
  const submits = () => api.calls.filter(call => call.path === "/api/drafts/d1/submit")
  return { api, user, tap, choice, change, copies, submits }
}

/** What the open confirmation says, part by part. */
function panel() {
  const dialog = within(confirmation())
  return {
    total: dialog.getByRole("status", { name: "Blätter insgesamt" }).textContent,
    settings: within(dialog.getByRole("list", { name: "Einstellungen" })).getAllByRole("listitem").map(chip => chip.textContent),
    message: dialog.getByRole("status", { name: "Hinweis" }).textContent,
    has: (text: string) => dialog.queryAllByText(text).length > 0,
    /** The badges of the pages or photos, in order. */
    badges: (group: "Seiten" | "Fotos") => within(dialog.getByRole("list", { name: group })).getAllByRole("listitem").map(item => item.textContent),
    drucken: dialog.getByRole("button", { name: "Drucken" }),
  }
}

test("the summary line under the preview is gone; the detailed controls are behind Einstellungen and go away with Fertig", async () => {
  const { user, choice } = await openOptions(pdfOf(1))
  expect(screen.queryByRole("status", { name: "Gewählte Einstellungen" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Ändern" })).not.toBeInTheDocument()
  for (const group of ["Farbe", "Papier", "Qualität"]) expect(screen.queryByRole("radiogroup", { name: group })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Mehr Kopien" })).not.toBeInTheDocument()

  await openDetails(user)

  const details = within(screen.getByRole("dialog", { name: "Einstellungen" }))
  for (const group of ["Farbe", "Papier", "Qualität"]) expect(details.getByRole("radiogroup", { name: group })).toBeInTheDocument()
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

  expect(panel().total).toBe("2")
  expect(submits()).toHaveLength(0)

  await user.click(panel().drucken)

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
  expect(panel().total).toBe("1")
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
  const { user, tap, choice, change, copies, submits } = await openOptions(pdfOf(3))
  await change(async () => {
    await copies(2)
    await user.click(choice("Papier", "A5"))
  })
  await tap("Seite 2")
  await tap("Nächstes Blatt")

  await tap("Drucken")
  await user.click(within(confirmation()).getByRole("button", { name: "Abbrechen" }))

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  expect(submits()).toHaveLength(0)
  expect(screen.getByRole("status", { name: "Blatt in der Vorschau" })).toHaveTextContent("Seite 3 · 2/2")
  expect(choice("Voreinstellung", "✎ Eigene")).toBeChecked()
  expect(await shownSettings(user)).toEqual({ copies: "2", color: "Farbe", paper: "A5", quality: "Normal" })

  await printAndConfirm(user)
  expect(await screen.findByText("Auftrag Nr. 42")).toBeInTheDocument()
  expect(JSON.parse(submits()[0]!.body as string)).toMatchObject({ copies: 2, paper: "A5", items: items(1, 0, 1) })
})

// The sheet counts are the ones the server reports for the same Print Jobs: see "the sheet count is the number of
// sheets in the PDF the Printer received" in server/status.test.ts.
test.each([
  { pages: 1, leftOut: [], perSheet: "Normal", copies: 1, total: "1", line: "1 Kopie" },
  { pages: 3, leftOut: [], perSheet: "Normal", copies: 2, total: "6", line: "3 × 2 Kopien" },
  { pages: 3, leftOut: [2], perSheet: "Normal", copies: 2, total: "4", line: "2 × 2 Kopien" },
  { pages: 3, leftOut: [], perSheet: "2×", copies: 5, total: "10", line: "2 × 5 Kopien" },
  { pages: 5, leftOut: [2], perSheet: "2×", copies: 1, total: "2", line: "1 Kopie" },
  { pages: 9, leftOut: [], perSheet: "8×", copies: 3, total: "6", line: "2 × 3 Kopien" },
])("a PDF of $pages pages at $perSheet, $copies copies: $total sheets, $line", async ({ pages, leftOut, perSheet, copies: count, total, line }) => {
  const { user, tap, choice, change, copies } = await openOptions(pdfOf(pages))
  await change(() => copies(count))
  await user.click(choice("Aufteilung", perSheet))
  for (const page of leftOut) await tap(`Seite ${page}`)

  await tap("Drucken")

  expect(panel().total).toBe(total)
  expect(panel().has(line)).toBe(true)
  expect(panel().has(perSheet)).toBe(true)
  expect(panel().has(total === "1" ? "Blatt" : "Blätter")).toBe(true)
})

test("the photos show with how often each prints, and the layout with its name", async () => {
  const { user, tap, choice } = await openOptions(photo, 3)
  await tap("Foto 2 öfter")
  await tap("Foto 3")
  await user.click(choice("Aufteilung", "4×"))

  await tap("Drucken")

  expect(panel().badges("Fotos")).toEqual(["1×", "2×", "aus"])
  expect(panel().total).toBe("1")
  expect(panel().has("4×")).toBe(true)
})

test("a PDF of more than 30 pages says its pages in one line", async () => {
  const { tap } = await openOptions(pdfOf(40))

  await tap("Drucken")
  expect(within(confirmation()).queryByRole("list", { name: "Seiten" })).not.toBeInTheDocument()
  expect(panel().has("40 von 40 Seiten, je 1×")).toBe(true)
  await tap("Abbrechen")

  await tap("Seite 3")
  await tap("Alle öfter")
  await tap("Drucken")
  expect(panel().has("39 von 40 Seiten, je 2× · 1 aus")).toBe(true)
  expect(panel().total).toBe("78")
})

test("every setting in use shows as a chip: for a PDF, colour, paper, quality, size, Position and the copies", async () => {
  const { user, tap, choice, change, copies } = await openOptions(pdfOf(1))
  await change(async () => {
    await copies(2)
    await user.click(choice("Farbe", "S/W"))
    await user.click(choice("Papier", "Umschlag C5"))
    await user.click(choice("Qualität", "Toner sparen"))
  })
  await user.click(choice("Größe für alle", "100 %"))
  await tap("Kleiner drucken")
  await user.click(choice("Position", "oben links"))

  await tap("Drucken")

  expect(panel().settings).toEqual(["S/W", "Umschlag C5", "Toner sparen", "95 %", "oben links", "2 Kopien"])
  // the chips only show: there is nothing to tap on them
  expect(within(within(confirmation()).getByRole("list", { name: "Einstellungen" })).queryAllByRole("button")).toEqual([])
})

test("at a Photo format the chips say the Lage, the gap and the cut lines instead of the Position, and the name says the format", async () => {
  const { user, tap, choice } = await openOptions(photo, 2)
  await user.click(choice("Aufteilung", "Passbild"))
  await user.click(screen.getByRole("switch", { name: "Schnittlinien" }))
  await user.click(choice("Größe für alle", "Füllen"))

  await tap("Drucken")
  expect(panel().settings).toEqual(["Farbe", "A4", "Normal", expect.stringMatching(/^Füllen/), "Platz sparen", "Abstand", "Schnittlinien"])
  expect(panel().has("Passbild")).toBe(true)
  await tap("Abbrechen")

  await user.click(choice("Aufteilung", "Eigenes"))
  await user.click(screen.getByRole("switch", { name: "Abstand zum Schneiden" }))
  await tap("Drucken")
  expect(panel().settings).toEqual(["Farbe", "A4", "Normal", expect.stringMatching(/^Füllen/), "Platz sparen", "Schnittlinien"])
  expect(panel().has("Eigenes 60 × 90 mm")).toBe(true)
})

test("the cut-off warning shows for a grid that cuts content off, and never at a Photo format", async () => {
  const pdf = await openOptions(pdfWithContent(inkInside))
  await pdf.tap("Drucken")
  expect(panel().message).toBe("")
  await pdf.tap("Abbrechen")

  // printed larger than the sheet, the ink reaches over the edge
  for (let i = 0; i < 3; i++) await pdf.tap("Größer drucken")
  expect(screen.getByRole("alert")).toHaveTextContent("Achtung: Teile des Inhalts werden abgeschnitten.")
  await pdf.tap("Drucken")
  expect(panel().message).toBe("⚠ Teile des Inhalts werden abgeschnitten.")
  expect(panel().drucken).toBeEnabled()
})

test("a new PDF starts at Füllen, and its cut-off warning follows where the page has ink", async () => {
  const inside = await openOptions(pdfWithContent(inkInside))
  expect(inside.choice("Größe für alle", "Füllen")).toBeChecked()
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  await inside.tap("Drucken")
  expect(panel().message).toBe("")
  cleanup()

  // the same page with ink in the unprintable edge
  const edge = await openOptions(pdfWithContent({ ...inkInside, left: 2 }))
  expect(edge.choice("Größe für alle", "Füllen")).toBeChecked()
  expect(screen.getByRole("alert")).toHaveTextContent("Achtung: Teile des Inhalts werden abgeschnitten.")
  await edge.tap("Drucken")
  expect(panel().message).toBe("⚠ Teile des Inhalts werden abgeschnitten.")
})

test("the cut-off warning stays away at a Photo format, cropped as the photos are", async () => {
  const { user, tap, choice } = await openOptions(photo, 2)
  await user.click(choice("Aufteilung", "10×15"))
  await user.click(choice("Größe für alle", "Füllen"))

  await tap("Drucken")

  expect(panel().message).toBe("")
})

test("the confirmation warns when only a later sheet is cut off", async () => {
  // page 2 is wider than the paper at 100 %, page 1 is not
  const facts: FileFacts = { kind: "pdf", pageCount: 2, pages: [{ width: 300, height: 300 }, { width: 900, height: 300 }] }
  const { user, tap, choice } = await openOptions(facts)
  await user.click(choice("Größe für alle", "100 %"))

  await tap("Drucken")

  expect(panel().message).toBe("⚠ Teile des Inhalts werden abgeschnitten.")
})

test("over 100 sheets the total is the one thing that counts: the panel says the limit and Drucken is unavailable", async () => {
  const confirmed = vi.fn()
  render(() => (
    <Confirmation
      kind="photos"
      source={{ kind: "photos", urls: ["blob:a", "blob:b"] }}
      refs={[0, 1]}
      options={{
        copies: 5, color: "color", paper: "A4", quality: "normal", printSize: { kind: "fill" }, position: "center",
        layout: { kind: "grid", perSheet: 8 }, items: items(50, 50),
      }}
      // the limit wins over the cut-off warning
      numbers={{ sheetsPerCopy: 13, sheets: 65, overLimit: true, paper: SHEET_SIZES.A4, cells: [], percent: undefined, mixedSizes: false, cutOff: true }}
      onConfirm={confirmed}
      onBack={() => {}}
    />
  ))

  expect(panel().total).toBe("65")
  expect(panel().has("13 × 5 Kopien")).toBe(true)
  expect(panel().message).toBe("⛔ Höchstens 100 Blätter pro Druck.")
  expect(panel().drucken).toBeDisabled()
  expect(panel().badges("Fotos")).toEqual(["50×", "50×"])
})

test.each([
  ["the percentage it prints at", false, "Füllen (97 %)"],
  ["that the size is chosen photo by photo", true, "Größe je Foto"],
])("the size chip says %s", (_name, mixedSizes, chip) => {
  render(() => (
    <Confirmation
      kind="photos"
      source={{ kind: "photos", urls: ["blob:a", "blob:b"] }}
      refs={[0, 1]}
      options={{
        copies: 1, color: "color", paper: "A4", quality: "normal", printSize: { kind: "fill" }, position: "center",
        layout: { kind: "grid", perSheet: 2 }, items: items(1, 1),
      }}
      numbers={{ sheetsPerCopy: 1, sheets: 1, overLimit: false, paper: SHEET_SIZES.A4, cells: [], percent: 97, mixedSizes, cutOff: false }}
      onConfirm={() => {}}
      onBack={() => {}}
    />
  ))

  expect(panel().settings).toContain(chip)
})
