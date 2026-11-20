import { cleanup, render, screen, within } from "@solidjs/testing-library"
import { userEvent } from "@testing-library/user-event"
import { expect, test } from "vitest"
import type { FileFacts } from "../../shared/api.ts"
import { App } from "./App.tsx"
import { json, mockApi } from "./testing/mock-api.ts"
import { closeDetails, laidOut, openDetails, printAndConfirm } from "./testing/options-screen.ts"

/** A landscape photo of 4000 × 3000 pixels. */
const photo: FileFacts = { kind: "photo", format: "jpeg", width: 4000, height: 3000, orientation: 1 }

const pdf: FileFacts = { kind: "pdf", pageCount: 2, pages: [{ width: 595, height: 842 }, { width: 595, height: 842 }] }

/** Opens the app, picks a PDF with these facts or `count` photos, and waits until the file is laid out. */
async function openOptions(facts: FileFacts, count = 1) {
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json(facts, 201),
    "POST /api/drafts/d1/submit": () => json({ jobId: "j1", cupsJobId: 42 }, 201),
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
  const tile = (name: string) => choice("Aufteilung", name)
  const tiles = () => within(screen.getByRole("radiogroup", { name: "Aufteilung" })).getAllByRole("radio").map(radio => radio.getAttribute("aria-label"))
  const sizes = () => within(screen.getByRole("radiogroup", { name: "Größe für alle" })).getAllByRole("radio").map(radio => radio.textContent)
  const toggle = (name: string) => screen.getByRole("switch", { name })
  const drucken = () => screen.getByRole("button", { name: "Drucken" })
  /** Types into one of the inputs of the own size. */
  async function own(side: "Breite" | "Höhe", mm: string) {
    const input = screen.getByRole("spinbutton", { name: side })
    await user.clear(input)
    if (mm) await user.type(input, mm)
  }
  return { user, print, choice, tile, tiles, sizes, toggle, drucken, own }
}

test("photos get the Photo formats after the grids; a PDF only the grids", async () => {
  const photos = await openOptions(photo, 2)
  expect(photos.tiles()).toEqual(["Normal", "2×", "4×", "6×", "8×", "10×15", "9×13", "13×18", "Passbild", "Eigenes"])
  cleanup()

  const document = await openOptions(pdf)
  expect(document.tiles()).toEqual(["Normal", "2×", "4×", "6×", "8×"])
})

test("at 10×15 the photos print as many to a sheet as fit, with Lage and the two switches for cutting", async () => {
  const { user, tile, choice, toggle, sizes, print } = await openOptions(photo, 3)
  expect(screen.queryByRole("radiogroup", { name: "Lage der Fotos" })).not.toBeInTheDocument()

  await user.click(tile("10×15"))

  // two upright and one sideways fit A4: one sheet, nothing to step through
  expect(tile("10×15")).toBeChecked()
  expect(screen.queryByRole("status", { name: "Blatt in der Vorschau" })).not.toBeInTheDocument()
  expect(choice("Lage der Fotos", "Platz sparen")).toBeChecked()
  expect(toggle("Abstand zum Schneiden")).toBeChecked()
  expect(toggle("Schnittlinien")).not.toBeChecked()
  expect(sizes()).toEqual(["Füllen", "Einpassen"])

  // all upright: two to a sheet
  await user.click(choice("Lage der Fotos", "Alle hoch"))
  expect(screen.getByRole("status", { name: "Blatt in der Vorschau" })).toHaveTextContent("Blatt 1/2")
  await user.click(toggle("Abstand zum Schneiden"))
  await user.click(toggle("Schnittlinien"))
  // another format keeps the Lage and the switches
  await user.click(tile("9×13"))

  expect(await print()).toMatchObject({ layout: { kind: "format", format: "9x13", lage: "portrait", gap: false, cutLines: true } })
})

test("a percentage becomes Füllen at a Photo format, and there is no cut-off warning: cropping to the format is expected", async () => {
  const { user, tile, choice, print } = await openOptions(photo, 2)
  const warning = () => screen.queryByText("Achtung: Teile des Inhalts werden abgeschnitten.")
  await user.click(choice("Größe für alle", "100 %"))
  await user.click(tile("4×"))
  await user.click(choice("Größe für alle", "Füllen"))
  expect(warning()).toBeInTheDocument()

  await user.click(choice("Größe für alle", "100 %"))
  await user.click(tile("Passbild"))

  expect(choice("Größe für alle", "Füllen")).toBeChecked()
  expect(warning()).not.toBeInTheDocument()
  expect(await print()).toMatchObject({ printSize: { kind: "fill" }, layout: { kind: "format", format: "pass" } })
})

test("a Photo format starts at Füllen, its default, and keeps Einpassen once it is chosen there", async () => {
  const { user, tile, choice, print } = await openOptions(photo, 2)
  // the Preset Foto prints at Einpassen
  expect(choice("Größe für alle", "Einpassen")).toBeChecked()

  await user.click(tile("10×15"))
  expect(choice("Größe für alle", "Füllen")).toBeChecked()

  await user.click(choice("Größe für alle", "Einpassen"))
  await user.click(tile("9×13"))

  expect(choice("Größe für alle", "Einpassen")).toBeChecked()
  expect(await print()).toMatchObject({ printSize: { kind: "fit" }, layout: { kind: "format", format: "9x13" } })
})

test("a format that doesn't fit the paper is greyed out, and Drucken says why when the paper changes under it", async () => {
  const { user, tile, choice, drucken } = await openOptions(photo, 2)
  await user.click(tile("13×18"))
  expect(drucken()).toBeEnabled()

  await openDetails(user)
  await user.click(choice("Papier", "Umschlag DL"))
  await closeDetails(user)

  expect(tile("13×18")).toBeDisabled()
  expect(tile("10×15")).toBeEnabled()
  expect(drucken()).toBeDisabled()
  expect(screen.getByRole("alert")).toHaveTextContent("13×18 passt nicht auf Umschlag DL.")

  await user.click(tile("10×15"))
  expect(drucken()).toBeEnabled()
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
})

test("Eigenes takes a width and a height in mm, at least 20 and no larger than the paper's printable area", async () => {
  const { user, tile, own, drucken, print } = await openOptions(photo, 2)
  expect(screen.queryByRole("spinbutton", { name: "Breite" })).not.toBeInTheDocument()

  await user.click(tile("Eigenes"))
  expect(screen.getByRole("spinbutton", { name: "Breite" })).toHaveValue(60)
  expect(screen.getByRole("spinbutton", { name: "Höhe" })).toHaveValue(90)

  await own("Breite", "15")
  expect(screen.getByRole("alert")).toHaveTextContent("Breite und Höhe mindestens 20 mm.")
  expect(drucken()).toBeDisabled()

  await own("Breite", "")
  expect(screen.getByRole("alert")).toHaveTextContent("Breite und Höhe mindestens 20 mm.")

  // A4 without the Printer's margins of 3.175 and 4.233 mm on each side: 203.65 × 288.53 mm. 300 × 90 fits neither way.
  await own("Breite", "300")
  expect(screen.getByRole("alert")).toHaveTextContent("Zu groß für A4: höchstens 203 × 288 mm.")
  expect(drucken()).toBeDisabled()

  await own("Breite", "100")
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  expect(drucken()).toBeEnabled()
  // the own size stays while another layout is chosen
  await user.click(tile("4×"))
  await user.click(tile("Eigenes"))
  expect(screen.getByRole("spinbutton", { name: "Breite" })).toHaveValue(100)
  expect(await print()).toMatchObject({ layout: { kind: "format", format: { w: 100, h: 90 }, lage: "save", gap: true, cutLines: false } })
})

test("an own size that only fits lying the other way says which Lage takes it", async () => {
  const { user, tile, choice, own, drucken } = await openOptions(photo, 2)
  await user.click(tile("Eigenes"))
  await user.click(choice("Lage der Fotos", "Alle quer"))

  // 250 mm across is wider than A4's printable 203 mm, but upright it is 150 wide and 250 high
  await own("Breite", "250")
  await own("Höhe", "150")

  expect(screen.getByRole("alert")).toHaveTextContent("Passt nur mit Lage Alle hoch.")
  expect(drucken()).toBeDisabled()

  await user.click(choice("Lage der Fotos", "Alle hoch"))
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  expect(drucken()).toBeEnabled()
})

test("a Preset saved at a Photo format brings back the format, the own size, the Lage and the switches", async () => {
  const first = await openOptions(photo, 2)
  await first.user.click(first.tile("Eigenes"))
  await first.own("Höhe", "45")
  await first.user.click(first.choice("Lage der Fotos", "Alle quer"))
  await first.user.click(first.toggle("Schnittlinien"))
  await openDetails(first.user)
  await first.user.click(screen.getByRole("button", { name: "Als Voreinstellung speichern …" }))
  await first.user.type(screen.getByLabelText('Name der Voreinstellung (z. B. "Bastelpapier")'), "Etiketten")
  await first.user.click(screen.getByRole("button", { name: "Speichern" }))
  await closeDetails(first.user)
  cleanup()

  const second = await openOptions(photo, 3)
  expect(second.tile("Normal")).toBeChecked()
  await second.user.click(second.choice("Voreinstellung", "Etiketten"))

  expect(second.tile("Eigenes")).toBeChecked()
  expect(screen.getByRole("spinbutton", { name: "Höhe" })).toHaveValue(45)
  expect(second.choice("Lage der Fotos", "Alle quer")).toBeChecked()
  expect(second.toggle("Schnittlinien")).toBeChecked()
  expect(await second.print()).toMatchObject({ layout: { kind: "format", format: { w: 60, h: 45 }, lage: "landscape", gap: true, cutLines: true } })
})
