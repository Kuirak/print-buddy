import { render, screen, within } from "@solidjs/testing-library"
import { userEvent } from "@testing-library/user-event"
import { expect, test, vi } from "vitest"
import type { FileFacts } from "../../shared/api.ts"
import { App } from "./App.tsx"
import { openPdf, type PdfPreview } from "./pdf-preview.ts"
import { json, mockApi, type ApiHandler } from "./testing/mock-api.ts"
import { openDetails, printAndConfirm } from "./testing/options-screen.ts"
import { printerInfo } from "./testing/printer-info.ts"

/** Two pages of US Letter: a little wider and a little shorter than A4 (595 × 842 pt). */
const letterPdf: FileFacts = { kind: "pdf", pageCount: 2, pages: [{ width: 612, height: 792 }, { width: 612, height: 792 }] }

/** One landscape photo of 4000 × 3000 pixels: 960 × 720 pt at 300 dpi. */
const landscapePhoto: FileFacts = { kind: "photo", format: "jpeg", width: 4000, height: 3000, orientation: 1 }

/**
 * Opens the app, picks a file with these facts and waits for the options screen with its preview.
 * `count` picks that many photos, all with the same facts. `routes` change what the server answers.
 */
async function openOptions(facts: FileFacts = letterPdf, { count = 1, routes = {} }: { count?: number; routes?: Record<string, ApiHandler> } = {}) {
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json(facts, 201),
    "POST /api/drafts/d1/submit": () => json({ jobId: "j1", cupsJobId: 42 }, 201),
    ...routes,
  })
  const user = userEvent.setup({ applyAccept: false })
  render(() => <App />)
  const files = Array.from({ length: count }, (_, index) => facts.kind === "pdf"
    ? new File(["%PDF-1.4"], "Brief.pdf", { type: "application/pdf" })
    : new File(["\xff\xd8\xff"], `Strand ${index + 1}.jpg`, { type: "image/jpeg" }))
  await user.upload(screen.getByLabelText("Datei auswählen"), files)
  await screen.findByRole("button", { name: "Drucken" })
  // the margins have arrived and the file is laid out
  await screen.findByRole("status", { name: "Druckgröße in Prozent" })

  /** Taps Drucken and returns the Print Options the app submitted. */
  async function print() {
    await printAndConfirm(user)
    await screen.findByText("Auftrag Nr. 42")
    return JSON.parse(api.calls.find(call => call.path === "/api/drafts/d1/submit")!.body as string) as Record<string, unknown>
  }
  const choice = (group: string, name: string) => within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name })
  const tap = (name: string) => user.click(screen.getByRole("button", { name }))
  /** The percentage the Print size row shows. */
  const percent = () => screen.findByRole("status", { name: "Druckgröße in Prozent" })
  return { api, user, files, print, choice, tap, percent }
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

test.each([
  // Füllen covers the whole sheet: 841.89 / 792 = 1.063
  ["Füllen", "106 %", { kind: "fill" }],
  ["100 %", "100 %", { kind: "percent", value: 100 }],
])("the shortcut %s shows %s and is submitted", async (name, shownPercent, printSize) => {
  const { user, choice, percent, print } = await openOptions()

  await user.click(choice("Druckgröße", name))

  expect(choice("Druckgröße", name)).toBeChecked()
  expect(choice("Druckgröße", "Einpassen")).not.toBeChecked()
  expect(await percent()).toHaveTextContent(shownPercent)
  expect(await print()).toMatchObject({ printSize })
})

test("− and + move the Print size in steps of 5 % from the percentage shown", async () => {
  const { tap, choice, percent, print } = await openOptions()
  expect(await percent()).toHaveTextContent("94 %")

  await tap("Größer drucken")
  expect(await percent()).toHaveTextContent("99 %")
  for (const name of ["Einpassen", "Füllen", "100 %"]) expect(choice("Druckgröße", name)).not.toBeChecked()

  await tap("Kleiner drucken")
  await tap("Kleiner drucken")
  await tap("Kleiner drucken")
  expect(await percent()).toHaveTextContent("84 %")
  expect(await print()).toMatchObject({ printSize: { kind: "percent", value: 84 } })
})

test("a step that lands on 100 % marks the 100 % shortcut", async () => {
  const { user, tap, choice } = await openOptions()
  await user.click(choice("Druckgröße", "100 %"))

  await tap("Größer drucken")
  expect(choice("Druckgröße", "100 %")).not.toBeChecked()
  await tap("Kleiner drucken")
  expect(choice("Druckgröße", "100 %")).toBeChecked()
})

test("the Print size stops at 10 %", async () => {
  const { user, choice, percent, print } = await openOptions()
  await user.click(choice("Druckgröße", "100 %"))
  const smaller = screen.getByRole("button", { name: "Kleiner drucken" })

  for (let i = 0; i < 20; i++) await user.click(smaller)

  expect(smaller).toBeDisabled()
  expect(await percent()).toHaveTextContent("10 %")
  expect(await print()).toMatchObject({ printSize: { kind: "percent", value: 10 } })
})

test("a warning shows while content is cut off, and goes away when it no longer is", async () => {
  const { user, tap, choice, percent } = await openOptions()
  const warning = () => screen.queryByText("Achtung: Teile des Inhalts werden abgeschnitten.")
  await percent()
  expect(warning()).not.toBeInTheDocument()

  // Füllen covers the whole sheet, so the unprintable edge takes some of the content
  await user.click(choice("Druckgröße", "Füllen"))
  expect(warning()).toBeInTheDocument()
  await user.click(choice("Druckgröße", "Einpassen"))
  expect(warning()).not.toBeInTheDocument()

  // at 100 % the page is 612 pt wide, the printable width of A4 is 577 pt
  await user.click(choice("Druckgröße", "100 %"))
  expect(warning()).toBeInTheDocument()
  // 95 % is 581 pt wide: still too wide. 90 % is 551 pt wide and 713 pt high: that fits
  await tap("Kleiner drucken")
  expect(warning()).toBeInTheDocument()
  await tap("Kleiner drucken")
  expect(warning()).not.toBeInTheDocument()
})

const spots = [
  ["oben links", "top-left"], ["oben", "top"], ["oben rechts", "top-right"],
  ["links", "left"], ["Mitte", "center"], ["rechts", "right"],
  ["unten links", "bottom-left"], ["unten", "bottom"], ["unten rechts", "bottom-right"],
] as const

test("the Position grid has 9 spots, row by row, and a new file sits in the middle", async () => {
  const { choice, print } = await openOptions()

  const grid = within(screen.getByRole("radiogroup", { name: "Position" })).getAllByRole("radio")
  expect(grid.map(spot => spot.getAttribute("aria-label"))).toEqual(spots.map(([label]) => label))
  expect(grid.filter(spot => spot.getAttribute("aria-checked") === "true")).toEqual([choice("Position", "Mitte")])
  expect(await print()).toMatchObject({ position: "center" })
})

test.each(spots)("the spot %s is the marked one after a tap, and is submitted as %s", async (label, position) => {
  const { user, choice, print } = await openOptions()

  // leave the middle first, so that tapping Mitte is a change too
  await user.click(choice("Position", label === "Mitte" ? "oben" : "Mitte"))
  await user.click(choice("Position", label))

  const grid = within(screen.getByRole("radiogroup", { name: "Position" })).getAllByRole("radio")
  expect(grid.filter(spot => spot.getAttribute("aria-checked") === "true")).toEqual([choice("Position", label)])
  expect(await print()).toMatchObject({ position })
})

test.each([
  // lying across the sheet, the 792 pt long side has to fit the printable width: 577.28 / 792 = 0.729
  [1, 90, "73 %"],
  [2, 180, "94 %"],
  [3, 270, "73 %"],
  [4, 0, "94 %"],
])("%i taps on Drehen turn the whole PDF to %i°", async (taps, rotation, shownPercent) => {
  const { tap, percent, print } = await openOptions()

  for (let i = 0; i < taps; i++) await tap("Drehen")

  expect(await percent()).toHaveTextContent(shownPercent)
  const submitted = await print()
  expect(submitted).toMatchObject({ rotation })
  expect(submitted).not.toHaveProperty("photoRotations")
})

test.each([
  // turned back upright by the tap, the 960 pt long side has to fit the printable width: 577.28 / 960 = 0.601
  [1, 90, "60 %"],
  [2, 180, "80 %"],
  [3, 270, "60 %"],
  [4, 0, "80 %"],
])("%i taps on Drehen turn the photo in the preview to %i°", async (taps, rotation, shownPercent) => {
  const { tap, percent, print } = await openOptions(landscapePhoto)

  for (let i = 0; i < taps; i++) await tap("Drehen")

  expect(await percent()).toHaveTextContent(shownPercent)
  // photos turn one by one: the one in the preview is the first, photo 0
  expect(await print()).toMatchObject({ rotation: 0, photoRotations: { 0: rotation } })
})

test("a landscape photo on a portrait sheet is turned at Einpassen and Füllen, and not at a percentage", async () => {
  const { user, tap, choice, percent, print } = await openOptions(landscapePhoto)

  // turned, the photo is 720 × 960 pt: 577.28 / 720 = 0.802. Left as it is, it would come out at 60 %
  expect(await percent()).toHaveTextContent("80 %")
  // 841.89 / 960 = 0.877. Left as it is, covering the sheet would take 117 %
  await user.click(choice("Druckgröße", "Füllen"))
  expect(await percent()).toHaveTextContent("88 %")

  // at 65 % the photo is 624 pt wide if it lies as shot, and 468 pt wide if it were turned.
  // The printable width is 577 pt, so only the photo as shot is cut off
  await user.click(choice("Druckgröße", "100 %"))
  for (let i = 0; i < 7; i++) await tap("Kleiner drucken")
  expect(await percent()).toHaveTextContent("65 %")
  expect(screen.getByText("Achtung: Teile des Inhalts werden abgeschnitten.")).toBeInTheDocument()
  expect(await print()).toMatchObject({ rotation: 0 })
})

test("a landscape PDF page is never turned on its own", async () => {
  const { percent } = await openOptions({ kind: "pdf", pageCount: 1, pages: [{ width: 792, height: 612 }] })

  // 577.28 / 792 = 0.729. Turned, the page would come out at 94 %
  expect(await percent()).toHaveTextContent("73 %")
})

test("the Print size follows the Printer's margins for the chosen paper", async () => {
  const wide = { top: 36, right: 36, bottom: 36, left: 36 }
  const { user, choice, percent } = await openOptions(letterPdf, {
    routes: { "GET /api/printer": () => printerInfo({ margins: { ...printerInfo().margins, A5: wide } }) },
  })
  expect(await percent()).toHaveTextContent("94 %")

  // A5 is 419.53 pt wide. Without 2 × 36 pt that leaves 347.53 pt, and 347.53 / 612 = 0.568
  await openDetails(user)
  await user.click(choice("Papier", "A5"))
  expect(await percent()).toHaveTextContent("57 %")

  // Umschlag DL is 311.81 pt wide, with 9 pt left and right: 293.81 / 612 = 0.480
  await user.click(choice("Papier", "Umschlag DL"))
  expect(await percent()).toHaveTextContent("48 %")
})

test("the preview draws the first page of the picked PDF through pdf.js", async () => {
  await openOptions()

  const page = await screen.findByRole("img", { name: "Vorschau Seite 1" })
  expect(openPdf).toHaveBeenCalledOnce()
  expect(new TextDecoder().decode(vi.mocked(openPdf).mock.calls[0]![0])).toBe("%PDF-1.4")
  const pdf: PdfPreview = await vi.mocked(openPdf).mock.results[0]!.value
  // the thumbnails are drawn through pdf.js too, far smaller than the preview
  const large = vi.mocked(pdf.renderPage).mock.calls.flatMap(([pageNumber, longSide], call) => (longSide >= 1000 ? [{ pageNumber, call }] : []))
  expect(large.map(({ pageNumber }) => pageNumber)).toEqual([1])
  expect(page).toContainElement(await vi.mocked(pdf.renderPage).mock.results[large[0]!.call]!.value)
  expect(screen.queryByRole("img", { name: "Vorschau Seite 2" })).not.toBeInTheDocument()
})

test("the preview shows the first of the picked photos", async () => {
  const made = vi.spyOn(URL, "createObjectURL")
  try {
    const { files } = await openOptions(landscapePhoto, { count: 2 })

    const photo = await screen.findByRole("img", { name: "Vorschau Foto 1" })
    const first = made.mock.calls.findIndex(([blob]) => blob === files[0])
    expect(photo).toHaveAttribute("src", made.mock.results[first]!.value)
    expect(screen.queryByRole("img", { name: "Vorschau Foto 2" })).not.toBeInTheDocument()
    expect(openPdf).not.toHaveBeenCalled()
  } finally {
    made.mockRestore()
  }
})

test("Ansicht zooms into the preview in four steps and back, and leaves the Print size alone", async () => {
  const { tap, print } = await openOptions()
  const pdf: PdfPreview = await vi.mocked(openPdf).mock.results[0]!.value
  /** How many pixels pdf.js was asked to draw the page in the preview with at most. The thumbnails are far smaller. */
  const sharpness = () => Math.max(...vi.mocked(pdf.renderPage).mock.calls.map(([, longSide]) => longSide))
  await screen.findByRole("img", { name: "Vorschau Seite 1" })
  const unzoomed = sharpness()

  expect(screen.getByText("Ansicht 100%")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Ansicht verkleinern" })).toBeDisabled()
  for (const label of ["Ansicht 150%", "Ansicht 200%", "Ansicht 300%"]) {
    await tap("Ansicht vergrößern")
    expect(screen.getByText(label)).toBeInTheDocument()
  }
  expect(screen.getByRole("button", { name: "Ansicht vergrößern" })).toBeDisabled()
  // zoomed in, the page is drawn again with more pixels, so details stay sharp
  expect(sharpness()).toBeGreaterThan(unzoomed)

  await tap("Ansicht verkleinern")
  expect(screen.getByText("Ansicht 200%")).toBeInTheDocument()
  expect(await print()).toMatchObject({ printSize: { kind: "fit" } })
})
