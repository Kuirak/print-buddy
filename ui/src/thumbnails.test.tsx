import { render, screen, within } from "@solidjs/testing-library"
import { userEvent } from "@testing-library/user-event"
import { expect, test } from "vitest"
import type { FileFacts } from "../../shared/api.ts"
import { App } from "./App.tsx"
import { json, mockApi } from "./testing/mock-api.ts"
import { closeDetails, openDetails, printAndConfirm } from "./testing/options-screen.ts"

/** A PDF of that many A4 pages. */
const pdfOf = (pageCount: number): FileFacts => ({ kind: "pdf", pageCount, pages: Array.from({ length: pageCount }, () => ({ width: 595, height: 842 })) })

const photo: FileFacts = { kind: "photo", format: "jpeg", width: 4000, height: 3000, orientation: 1 }

/** Opens the app, picks a PDF with these facts, or `count` photos, and waits until the file is laid out. */
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
  await screen.findByRole("status", { name: "Blatt in der Vorschau" })

  /** Taps Drucken and returns the Print Options the app submitted. */
  async function print() {
    await printAndConfirm(user)
    await screen.findByText("Auftrag Nr. 42")
    return JSON.parse(api.calls.find(call => call.path === "/api/drafts/d1/submit")!.body as string) as Record<string, unknown>
  }
  const choice = (group: string, name: string) => within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name })
  const tap = (name: string) => user.click(screen.getByRole("button", { name }))
  /** The thumbnails as the screen shows them: their names, and which of them are selected. */
  function thumbnails(group: "Seiten" | "Fotos") {
    const all = within(screen.getByRole("group", { name: group })).getAllByRole("button")
    return {
      names: all.map(thumbnail => thumbnail.getAttribute("aria-label")),
      selected: all.filter(thumbnail => thumbnail.getAttribute("aria-pressed") === "true").map(thumbnail => thumbnail.getAttribute("aria-label")),
    }
  }
  /** Which sheet the preview shows, of how many. */
  const sheet = () => screen.getByRole("status", { name: "Blatt in der Vorschau" }).textContent
  return { api, user, files, print, choice, tap, thumbnails, sheet }
}

test("a PDF shows one thumbnail per page, all selected", async () => {
  const { thumbnails, print } = await openOptions(pdfOf(3))

  expect(thumbnails("Seiten")).toEqual({ names: ["Seite 1", "Seite 2", "Seite 3"], selected: ["Seite 1", "Seite 2", "Seite 3"] })
  expect(await print()).toMatchObject({ selection: [1, 2, 3] })
})

test("photos show one thumbnail per photo, in the order picked, all selected", async () => {
  const { thumbnails, print } = await openOptions(photo, 3)

  expect(thumbnails("Fotos")).toEqual({ names: ["Foto 1", "Foto 2", "Foto 3"], selected: ["Foto 1", "Foto 2", "Foto 3"] })
  // each thumbnail is the picture of its own file
  const pictures = within(screen.getByRole("group", { name: "Fotos" })).getAllByRole("button").map(thumbnail => thumbnail.querySelector("img")?.getAttribute("src"))
  expect(pictures).toEqual(["blob:Strand 1.jpg", "blob:Strand 2.jpg", "blob:Strand 3.jpg"])
  expect(await print()).toMatchObject({ selection: [0, 1, 2] })
})

test("a PDF's thumbnails are its pages, drawn small through pdf.js", async () => {
  await openOptions(pdfOf(3))

  /** What pdf.js was asked to draw in each thumbnail: the page, and with how many pixels. */
  const drawn = () => within(screen.getByRole("group", { name: "Seiten" })).getAllByRole("button").map(thumbnail => {
    const canvas = thumbnail.querySelector("canvas")
    return canvas && { page: canvas.dataset.page, small: canvas.width < 500 }
  })
  await expect.poll(drawn).toEqual([{ page: "1", small: true }, { page: "2", small: true }, { page: "3", small: true }])
})

test("tapping a thumbnail leaves the page out, and the sheet count follows", async () => {
  const { tap, thumbnails, sheet, print } = await openOptions(pdfOf(3))
  expect(sheet()).toBe("Seite 1 · 1/3")

  await tap("Seite 2")

  expect(thumbnails("Seiten").selected).toEqual(["Seite 1", "Seite 3"])
  expect(sheet()).toBe("Seite 1 · 1/2")
  expect(await print()).toMatchObject({ selection: [1, 3] })
})

test("a page brought back prints at its place in the PDF, and the preview goes to it", async () => {
  const { tap, thumbnails, sheet, print } = await openOptions(pdfOf(3))

  await tap("Seite 1")
  expect(sheet()).toBe("Seite 2 · 1/2")
  await tap("Seite 3")
  await tap("Seite 3")
  expect(sheet()).toBe("Seite 3 · 2/2")
  await tap("Seite 1")

  expect(sheet()).toBe("Seite 1 · 1/3")
  expect(thumbnails("Seiten").selected).toEqual(["Seite 1", "Seite 2", "Seite 3"])
  expect(await print()).toMatchObject({ selection: [1, 2, 3] })
})

test("tapping a photo's thumbnail leaves the photo out, and the sheet count follows", async () => {
  const { tap, thumbnails, sheet, print } = await openOptions(photo, 3)
  expect(sheet()).toBe("Foto 1/3")

  await tap("Foto 1")

  expect(thumbnails("Fotos").selected).toEqual(["Foto 2", "Foto 3"])
  expect(sheet()).toBe("Foto 1/2")
  expect(screen.getByRole("img", { name: "Vorschau Foto 2" })).toBeInTheDocument()
  expect(await print()).toMatchObject({ selection: [1, 2] })
})

test("the preview steps forwards and backwards through the sheets of the selection", async () => {
  const { tap, sheet } = await openOptions(pdfOf(4))
  await tap("Seite 2")
  const back = screen.getByRole("button", { name: "Vorheriges Blatt" })
  const on = screen.getByRole("button", { name: "Nächstes Blatt" })

  expect(sheet()).toBe("Seite 1 · 1/3")
  expect(await screen.findByRole("img", { name: "Vorschau Seite 1" })).toBeInTheDocument()
  expect(back).toBeDisabled()

  await tap("Nächstes Blatt")
  expect(sheet()).toBe("Seite 3 · 2/3")
  expect(await screen.findByRole("img", { name: "Vorschau Seite 3" })).toBeInTheDocument()
  expect(screen.queryByRole("img", { name: "Vorschau Seite 1" })).not.toBeInTheDocument()

  await tap("Nächstes Blatt")
  expect(sheet()).toBe("Seite 4 · 3/3")
  expect(on).toBeDisabled()

  await tap("Vorheriges Blatt")
  expect(sheet()).toBe("Seite 3 · 2/3")
})

test("leaving out the page in the preview shows the last sheet that is left", async () => {
  const { tap, sheet } = await openOptions(pdfOf(3))
  await tap("Nächstes Blatt")
  await tap("Nächstes Blatt")
  expect(sheet()).toBe("Seite 3 · 3/3")

  await tap("Seite 3")

  expect(sheet()).toBe("Seite 2 · 2/2")
  expect(screen.getByRole("button", { name: "Nächstes Blatt" })).toBeDisabled()
  await tap("Vorheriges Blatt")
  expect(sheet()).toBe("Seite 1 · 1/2")
})

test("Drehen turns only the photo in the preview", async () => {
  const { tap, sheet, print } = await openOptions(photo, 3)

  await tap("Nächstes Blatt")
  expect(sheet()).toBe("Foto 2/3")
  await tap("Drehen")
  await tap("Nächstes Blatt")
  await tap("Drehen")
  await tap("Drehen")

  expect(await print()).toMatchObject({ rotation: 0, photoRotations: { 1: 90, 2: 180 }, selection: [0, 1, 2] })
})

test("Drehen turns the photo shown, not the first one, when the first is left out", async () => {
  const { tap, print } = await openOptions(photo, 2)

  await tap("Foto 1")
  await tap("Drehen")

  expect(await print()).toEqual(expect.objectContaining({ photoRotations: { 1: 90 }, selection: [1] }))
})

test("a PDF can be printed with two pages per sheet, and the preview shows both halves", async () => {
  const { user, choice, sheet, print } = await openOptions(pdfOf(5))
  await openDetails(user)
  expect(choice("Seiten pro Blatt", "1")).toBeChecked()
  expect(sheet()).toBe("Seite 1 · 1/5")

  await user.click(choice("Seiten pro Blatt", "2"))

  expect(choice("Seiten pro Blatt", "2")).toBeChecked()
  await closeDetails(user)
  expect(sheet()).toBe("Seiten 1 und 2 · 1/3")
  expect(await screen.findByRole("img", { name: "Vorschau Seite 1" })).toBeInTheDocument()
  expect(await screen.findByRole("img", { name: "Vorschau Seite 2" })).toBeInTheDocument()
  expect(await print()).toMatchObject({ pagesPerSheet: 2, selection: [1, 2, 3, 4, 5] })
})

test("with two pages per sheet the sheet count follows the selection", async () => {
  const { user, tap, choice, sheet, print } = await openOptions(pdfOf(5))
  await openDetails(user)
  await user.click(choice("Seiten pro Blatt", "2"))
  await closeDetails(user)

  // pages 1, 3, 4 and 5 are left: two sheets
  await tap("Seite 2")
  expect(sheet()).toBe("Seiten 1 und 3 · 1/2")
  await tap("Nächstes Blatt")
  expect(sheet()).toBe("Seiten 4 und 5 · 2/2")

  // three pages: the last sheet has one half
  await tap("Seite 4")
  expect(sheet()).toBe("Seite 5 · 2/2")
  // brought back, page 2 is on the first sheet again
  await tap("Seite 2")
  expect(sheet()).toBe("Seiten 1 und 2 · 1/2")
  expect(await print()).toMatchObject({ pagesPerSheet: 2, selection: [1, 2, 3, 5] })
})

test("two pages per sheet are not offered for photos", async () => {
  const { user, print } = await openOptions(photo, 2)

  await openDetails(user)
  expect(screen.getByRole("radiogroup", { name: "Papier" })).toBeInTheDocument()
  expect(screen.queryByRole("radiogroup", { name: "Seiten pro Blatt" })).not.toBeInTheDocument()
  expect(screen.queryByText("Seiten pro Blatt")).not.toBeInTheDocument()
  await closeDetails(user)
  expect(await print()).toMatchObject({ pagesPerSheet: 1 })
})

test.each([
  ["PDF", pdfOf(2), 1, ["Seite 1", "Seite 2"], "Keine Seiten ausgewählt", "Keine Seiten gewählt"],
  ["photo share", photo, 2, ["Foto 1", "Foto 2"], "Keine Fotos ausgewählt", "Keine Fotos gewählt"],
] as const)("Drucken is unavailable while nothing of a %s is selected", async (_, facts, count, names, hint, label) => {
  const { api, user, tap, sheet } = await openOptions(facts, count)

  for (const name of names) await tap(name)

  expect(sheet()).toBe(hint)
  expect(screen.queryByRole("button", { name: "Drucken" })).not.toBeInTheDocument()
  const unavailable = screen.getByRole("button", { name: label })
  expect(unavailable).toBeDisabled()
  await user.click(unavailable)
  expect(api.calls.filter(call => call.path === "/api/drafts/d1/submit")).toEqual([])

  await tap(names[1])
  expect(screen.getByRole("button", { name: "Drucken" })).toBeEnabled()
})

test("Keine leaves everything out and Alle selects everything again", async () => {
  const { tap, thumbnails, sheet, print } = await openOptions(pdfOf(3))
  expect(screen.getByText("Seiten zum Drucken antippen:")).toBeInTheDocument()
  await tap("Nächstes Blatt")

  await tap("Keine")
  expect(thumbnails("Seiten").selected).toEqual([])

  await tap("Alle")
  expect(thumbnails("Seiten").selected).toEqual(["Seite 1", "Seite 2", "Seite 3"])
  expect(sheet()).toBe("Seite 1 · 1/3")
  expect(await print()).toMatchObject({ selection: [1, 2, 3] })
})

test("picking a Preset leaves the page selection and the rotation alone", async () => {
  const { user, tap, choice, thumbnails, print } = await openOptions(pdfOf(3))
  await tap("Seite 2")
  await tap("Drehen")

  await user.click(choice("Voreinstellung", "Dokument s/w"))

  expect(choice("Voreinstellung", "Dokument s/w")).toBeChecked()
  expect(thumbnails("Seiten").selected).toEqual(["Seite 1", "Seite 3"])
  expect(await print()).toMatchObject({ color: "mono", rotation: 90, selection: [1, 3] })
})

test("picking a Preset leaves the photo selection and each photo's rotation alone", async () => {
  const { user, tap, choice, thumbnails, print } = await openOptions(photo, 3)
  await tap("Foto 1")
  await tap("Nächstes Blatt")
  await tap("Drehen")

  await user.click(choice("Voreinstellung", "Foto s/w Toner sparen"))

  expect(thumbnails("Fotos").selected).toEqual(["Foto 2", "Foto 3"])
  expect(await print()).toMatchObject({ color: "mono", quality: "draft", rotation: 0, photoRotations: { 2: 90 }, selection: [1, 2] })
})
