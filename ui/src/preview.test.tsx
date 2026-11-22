import { render, screen, within } from "@solidjs/testing-library"
import { userEvent } from "@testing-library/user-event"
import { afterEach, expect, test, vi } from "vitest"
import type { FileFacts } from "../../shared/api.ts"
import { App } from "./App.tsx"
import { json, mockApi, type ApiHandler } from "./testing/mock-api.ts"
import { laidOut, openDetails, printAndConfirm } from "./testing/options-screen.ts"
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
  await laidOut()

  /** Taps Drucken and returns the Print Options the app submitted. */
  async function print() {
    await printAndConfirm(user)
    await screen.findByText("Auftrag Nr. 42")
    return JSON.parse(api.calls.find(call => call.path === "/api/drafts/d1/submit")!.body as string) as Record<string, unknown>
  }
  const choice = (group: string, name: string) => within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name })
  /** A shortcut of "Größe für alle". */
  const size = (name: string) => choice("Größe für alle", name)
  const tap = (name: string) => user.click(screen.getByRole("button", { name }))
  /** The percentage the Print size row shows. */
  const percent = () => screen.findByRole("status", { name: "Druckgröße in Prozent" })
  /** The bar of the page or photo picked in the preview, if one is picked. */
  const bar = (name: string) => screen.queryByRole("toolbar", { name })
  return { api, user, files, print, choice, size, tap, percent, bar }
}

test("a new file starts at Einpassen, and the Print size row shows the percentage that gives", async () => {
  const { size, percent, print } = await openOptions()

  // the printable width of A4 is 595.28 − 2 × 9 = 577.28 pt, and 577.28 / 612 = 0.943
  expect(await percent()).toHaveTextContent("94 %")
  expect(size("Einpassen")).toBeChecked()
  expect(size("Füllen")).not.toBeChecked()
  expect(size("100 %")).not.toBeChecked()
  expect(await print()).toMatchObject({ printSize: { kind: "fit" } })
})

test.each([
  // Füllen covers the whole sheet: 841.89 / 792 = 1.063
  ["Füllen", "106 %", { kind: "fill" }],
  ["100 %", "100 %", { kind: "percent", value: 100 }],
])("the shortcut %s shows %s and is submitted", async (name, shownPercent, printSize) => {
  const { user, size, percent, print } = await openOptions()

  await user.click(size(name))

  expect(size(name)).toBeChecked()
  expect(size("Einpassen")).not.toBeChecked()
  expect(await percent()).toHaveTextContent(shownPercent)
  expect(await print()).toMatchObject({ printSize })
})

test("− and + move the Print size in steps of 5 % from the percentage shown", async () => {
  const { tap, size, percent, print } = await openOptions()
  expect(await percent()).toHaveTextContent("94 %")

  await tap("Größer drucken")
  expect(await percent()).toHaveTextContent("99 %")
  for (const name of ["Einpassen", "Füllen", "100 %"]) expect(size(name)).not.toBeChecked()

  await tap("Kleiner drucken")
  await tap("Kleiner drucken")
  await tap("Kleiner drucken")
  expect(await percent()).toHaveTextContent("84 %")
  expect(await print()).toMatchObject({ printSize: { kind: "percent", value: 84 } })
})

test("a step that lands on 100 % marks the 100 % shortcut", async () => {
  const { user, tap, size } = await openOptions()
  await user.click(size("100 %"))

  await tap("Größer drucken")
  expect(size("100 %")).not.toBeChecked()
  await tap("Kleiner drucken")
  expect(size("100 %")).toBeChecked()
})

test("the Print size stops at 10 %", async () => {
  const { user, size, percent, print } = await openOptions()
  await user.click(size("100 %"))
  const smaller = screen.getByRole("button", { name: "Kleiner drucken" })

  for (let i = 0; i < 20; i++) await user.click(smaller)

  expect(smaller).toBeDisabled()
  expect(await percent()).toHaveTextContent("10 %")
  expect(await print()).toMatchObject({ printSize: { kind: "percent", value: 10 } })
})

test("a warning shows while content is cut off, and goes away when it no longer is", async () => {
  const { user, tap, size, percent } = await openOptions()
  const warning = () => screen.queryByText("Achtung: Teile des Inhalts werden abgeschnitten.")
  await percent()
  expect(warning()).not.toBeInTheDocument()

  // Füllen covers the whole sheet, so the unprintable edge takes some of the content
  await user.click(size("Füllen"))
  expect(warning()).toBeInTheDocument()
  await user.click(size("Einpassen"))
  expect(warning()).not.toBeInTheDocument()

  // at 100 % the page is 612 pt wide, the printable width of A4 is 577 pt
  await user.click(size("100 %"))
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

test("a tap on a page in the preview opens its bar in the place of the stepper; ↻ and ↺ turn that page only", async () => {
  const { user, tap, percent, bar, print } = await openOptions()
  expect(screen.queryByRole("button", { name: "Drehen" })).not.toBeInTheDocument()
  expect(screen.getByRole("status", { name: "Blatt in der Vorschau" })).toBeInTheDocument()

  await user.click(await screen.findByRole("img", { name: "Vorschau Seite 1" }))

  expect(bar("Seite 1")).toBeInTheDocument()
  expect(screen.queryByRole("status", { name: "Blatt in der Vorschau" })).not.toBeInTheDocument()
  // lying across the sheet, the 792 pt long side has to fit the printable width: 577.28 / 792 = 0.729
  await tap("Nach rechts drehen")
  expect(await percent()).toHaveTextContent("73 %")
  await tap("Nach rechts drehen")
  expect(await percent()).toHaveTextContent("94 %")
  await tap("Nach links drehen")
  expect(await percent()).toHaveTextContent("73 %")
  expect(screen.getByRole("img", { name: "Seite 1 von Hand gedreht" })).toBeInTheDocument()
  expect(await print()).toMatchObject({ items: [{ count: 1, turn: 90 }, { count: 1, turn: 0 }] })
})

test("a tap on a photo picks that photo, and its bar turns it", async () => {
  const { user, tap, bar, print } = await openOptions(landscapePhoto, { count: 2 })

  await user.click(screen.getByRole("img", { name: "Vorschau Foto 1" }))
  await tap("Nach links drehen")

  expect(within(bar("Foto 1")!).getByRole("button", { name: "Nach rechts drehen" })).toBeInTheDocument()
  expect(screen.getByRole("img", { name: "Foto 1 von Hand gedreht" })).toBeInTheDocument()
  expect(screen.queryByRole("img", { name: "Foto 2 von Hand gedreht" })).not.toBeInTheDocument()
  expect(await print()).toMatchObject({ items: [{ count: 1, turn: 270 }, { count: 1, turn: 0 }] })
})

test("the bar switches one page between Füllen and Einpassen; Größe für alle then shows both in use, and choosing one sets every page again", async () => {
  const { user, size, percent, bar, print } = await openOptions()
  await user.click(await screen.findByRole("img", { name: "Vorschau Seite 1" }))

  await user.click(within(bar("Seite 1")!).getByRole("button", { name: "Einpassen" }))

  // Füllen covers the whole sheet: 841.89 / 792 = 1.063
  expect(await percent()).toHaveTextContent("106 %")
  expect(within(bar("Seite 1")!).getByRole("button", { name: "Füllen" })).toBeInTheDocument()
  for (const name of ["Einpassen", "Füllen", "100 %"]) expect(size(name)).not.toBeChecked()
  expect(size("Einpassen")).toHaveAccessibleDescription("bei einigen")
  expect(size("Füllen")).toHaveAccessibleDescription("bei einigen")
  expect(size("100 %")).not.toHaveAccessibleDescription()

  await user.click(size("100 %"))

  expect(size("100 %")).toBeChecked()
  expect(size("Füllen")).not.toHaveAccessibleDescription()
  expect(await print()).toMatchObject({ printSize: { kind: "percent", value: 100 }, items: [{ count: 1, turn: 0 }, { count: 1, turn: 0 }] })
})

test("the bar closes with ✕ and when any other control is touched, and the stepper comes back", async () => {
  const { user, tap, choice, bar } = await openOptions()
  const pick = async () => {
    await user.click(await screen.findByRole("img", { name: "Vorschau Seite 1" }))
    expect(bar("Seite 1")).toBeInTheDocument()
  }

  await pick()
  await tap("Schließen")
  expect(bar("Seite 1")).not.toBeInTheDocument()
  expect(screen.getByRole("status", { name: "Blatt in der Vorschau" })).toBeInTheDocument()

  await pick()
  await user.click(choice("Position", "oben"))
  expect(bar("Seite 1")).not.toBeInTheDocument()

  await pick()
  await tap("Ansicht vergrößern")
  expect(bar("Seite 1")).not.toBeInTheDocument()
})

/** The paper drawn 400 px wide: 1 px is 595.28 / 400 pt. */
const paperRect = { width: 400, height: 566, x: 0, y: 0, top: 0, left: 0, right: 400, bottom: 566, toJSON() {} }

afterEach(() => { vi.restoreAllMocks() })

test("a picked page that overlaps the border can be panned by dragging its 4-arrow overlay; Position takes over again after it", async () => {
  const { user, bar, print } = await openOptions()
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(paperRect)
  await user.click(await screen.findByRole("img", { name: "Vorschau Seite 1" }))
  // Einpassen lies inside the printable area: nothing to pan
  expect(screen.queryByRole("group", { name: "Seite 1 verschieben" })).not.toBeInTheDocument()

  // Füllen overlaps the printable width by 73.27 pt
  await user.click(within(bar("Seite 1")!).getByRole("button", { name: "Einpassen" }))
  const overlay = await screen.findByRole("group", { name: "Seite 1 verschieben" })
  await user.pointer([
    { keys: "[MouseLeft>]", target: overlay, coords: { clientX: 100, clientY: 100 } },
    { target: overlay, coords: { clientX: 80, clientY: 100 } },
    { keys: "[/MouseLeft]", target: overlay, coords: { clientX: 80, clientY: 100 } },
  ])

  // 20 px left is 29.76 pt: the page lies 29.76 / 73.27 further along; it is still the picked one
  expect(bar("Seite 1")).toBeInTheDocument()
  const submitted = await print()
  const [first] = (submitted as { items: { pan?: { x: number; y: number } }[] }).items
  expect(first!.pan!.x).toBeCloseTo(0.906, 2)
  expect(first!.pan!.y).toBe(0.5)
})

test("a pan is dropped when Position is chosen, and kept when the page is turned", async () => {
  const { user, tap, choice, bar, print } = await openOptions()
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(paperRect)
  await user.click(await screen.findByRole("img", { name: "Vorschau Seite 1" }))
  await user.click(within(bar("Seite 1")!).getByRole("button", { name: "Einpassen" }))
  ;(await screen.findByRole("group", { name: "Seite 1 verschieben" })).focus()
  await user.keyboard("{ArrowLeft}")
  await tap("Nach rechts drehen")

  // turned a quarter, the page's own x axis lies along the sheet's y: the key moved x, and that stays with the page
  const [turned] = ((await print()) as { items: { turn: number; pan?: { x?: number; y?: number } }[] }).items
  expect(turned).toMatchObject({ turn: 90 })
  expect(turned!.pan?.x).toBeGreaterThan(0.5)
})

test("choosing a Position drops a pan", async () => {
  const { user, choice, bar, print } = await openOptions()
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(paperRect)
  await user.click(await screen.findByRole("img", { name: "Vorschau Seite 1" }))
  await user.click(within(bar("Seite 1")!).getByRole("button", { name: "Einpassen" }))
  ;(await screen.findByRole("group", { name: "Seite 1 verschieben" })).focus()
  await user.keyboard("{ArrowLeft}")

  await user.click(choice("Position", "oben"))

  const [first] = ((await print()) as { items: object[] }).items
  expect(first).not.toHaveProperty("pan")
})

test("Größe für alle offers Füllen, Einpassen and 100 % for photos, without percentage steps; PDFs keep the steps", async () => {
  await openOptions(landscapePhoto, { count: 2 })

  expect(within(screen.getByRole("radiogroup", { name: "Größe für alle" })).getAllByRole("radio").map(chip => chip.textContent)).toEqual(["Füllen", "Einpassen", "100 %"])
  expect(screen.queryByRole("button", { name: "Größer drucken" })).not.toBeInTheDocument()
  expect(screen.getByRole("radiogroup", { name: "Position" })).toBeInTheDocument()
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
  expect(page.querySelector("canvas")!.dataset).toMatchObject({ pdf: "%PDF-1.4", page: "1" })
  expect(screen.queryByRole("img", { name: "Vorschau Seite 2" })).not.toBeInTheDocument()
})

test("the preview shows the first of the picked photos", async () => {
  await openOptions(landscapePhoto, { count: 2 })

  expect(await screen.findByRole("img", { name: "Vorschau Foto 1" })).toHaveAttribute("src", "blob:Strand 1.jpg")
  expect(screen.queryByRole("img", { name: "Vorschau Foto 2" })).not.toBeInTheDocument()
  // photos don't go through pdf.js
  expect(document.querySelector("canvas")).toBeNull()
})

test("Ansicht zooms into the preview in four steps and back, and leaves the Print size alone", async () => {
  const { tap, print } = await openOptions()
  /** How many pixels pdf.js was asked to draw the page in the preview with. */
  const sharpness = () => screen.getByRole("img", { name: "Vorschau Seite 1" }).querySelector("canvas")!.width
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
  await expect.poll(sharpness).toBeGreaterThan(unzoomed)

  await tap("Ansicht verkleinern")
  expect(screen.getByText("Ansicht 200%")).toBeInTheDocument()
  expect(await print()).toMatchObject({ printSize: { kind: "fit" } })
})
