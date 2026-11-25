import { render, screen, within } from "@solidjs/testing-library"
import { userEvent } from "@testing-library/user-event"
import { expect, test } from "vitest"
import type { FileFacts } from "../../shared/api.ts"
import { App } from "./App.tsx"
import { json, mockApi } from "./testing/mock-api.ts"
import { closeDetails, items, laidOut, openDetails, printAndConfirm } from "./testing/options-screen.ts"

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
  // the upload is done and the margins have arrived: the file is laid out from the server's facts
  await laidOut()

  /** Taps Drucken and returns the Print Options the app submitted. */
  async function print() {
    await printAndConfirm(user)
    await screen.findByText("Auftrag Nr. 42")
    return JSON.parse(api.calls.find(call => call.path === "/api/drafts/d1/submit")!.body as string) as Record<string, unknown>
  }
  const choice = (group: string, name: string) => within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name })
  const tap = (name: string) => user.click(screen.getByRole("button", { name }))
  /** The thumbnails as the screen shows them: their names, and which of them print. */
  function thumbnails(group: "Seiten" | "Fotos") {
    const all = pictures(group)
    return {
      names: all.map(thumbnail => thumbnail.getAttribute("aria-label")),
      selected: all.filter(thumbnail => thumbnail.getAttribute("aria-pressed") === "true").map(thumbnail => thumbnail.getAttribute("aria-label")),
    }
  }
  /** How often each page or photo prints, as its badge says it: "2×" or "aus". */
  const counts = (group: "Seiten" | "Fotos") =>
    pictures(group).map(thumbnail => screen.getByRole("status", { name: `Wie oft ${thumbnail.getAttribute("aria-label")}` }).textContent)
  /** What "Alle gleich" shows: "2×", or "≠" while the counts differ. */
  const allSame = () => screen.getByRole("status", { name: "Alle gleich" }).textContent
  /** Which sheet the preview shows, of how many. */
  const sheet = () => screen.getByRole("status", { name: "Blatt in der Vorschau" }).textContent
  /**
   * A finger drawn across the preview by `dx` and `dy` pixels: down, two moves, up, as a touch screen sends it.
   * Negative `dx` is to the left.
   */
  async function swipe(dx: number, dy = 0) {
    const preview = screen.getByRole("region", { name: "Vorschau" })
    const at = (share: number) => ({ clientX: 200 + dx * share, clientY: 300 + dy * share })
    await user.pointer([
      { keys: "[TouchA>]", target: preview, coords: at(0) },
      { pointerName: "TouchA", target: preview, coords: at(0.5) },
      { pointerName: "TouchA", target: preview, coords: at(1) },
      { keys: "[/TouchA]", target: preview, coords: at(1) },
    ])
  }
  return { api, user, files, print, choice, tap, thumbnails, counts, allSame, sheet, swipe }
}

/** The pictures of the pages or photos: the buttons that switch one on or off. */
function pictures(group: "Seiten" | "Fotos") {
  return within(screen.getByRole("group", { name: group })).getAllByRole("button").filter(button => button.hasAttribute("aria-pressed"))
}

test("a PDF shows one thumbnail per page, all selected", async () => {
  const { thumbnails, print } = await openOptions(pdfOf(3))

  expect(thumbnails("Seiten")).toEqual({ names: ["Seite 1", "Seite 2", "Seite 3"], selected: ["Seite 1", "Seite 2", "Seite 3"] })
  expect(await print()).toMatchObject({ items: items(1, 1, 1) })
})

test("photos show one thumbnail per photo, in the order picked, all selected", async () => {
  const { thumbnails, print } = await openOptions(photo, 3)

  expect(thumbnails("Fotos")).toEqual({ names: ["Foto 1", "Foto 2", "Foto 3"], selected: ["Foto 1", "Foto 2", "Foto 3"] })
  // each thumbnail is the picture of its own file
  const shown = pictures("Fotos").map(thumbnail => thumbnail.querySelector("img")?.getAttribute("src"))
  expect(shown).toEqual(["blob:Strand 1.jpg", "blob:Strand 2.jpg", "blob:Strand 3.jpg"])
  expect(await print()).toMatchObject({ items: items(1, 1, 1) })
})

test("a PDF's thumbnails are its pages, drawn small through pdf.js", async () => {
  await openOptions(pdfOf(3))

  /** What pdf.js was asked to draw in each thumbnail: the page, and with how many pixels. */
  const drawn = () => pictures("Seiten").map(thumbnail => {
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
  expect(await print()).toMatchObject({ items: items(1, 0, 1) })
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
  expect(await print()).toMatchObject({ items: items(1, 1, 1) })
})

test("tapping a photo's thumbnail leaves the photo out, and the sheet count follows", async () => {
  const { tap, thumbnails, sheet, print } = await openOptions(photo, 3)
  expect(sheet()).toBe("Foto 1/3")

  await tap("Foto 1")

  expect(thumbnails("Fotos").selected).toEqual(["Foto 2", "Foto 3"])
  expect(sheet()).toBe("Foto 1/2")
  expect(screen.getByRole("img", { name: "Vorschau Foto 2" })).toBeInTheDocument()
  expect(await print()).toMatchObject({ items: items(0, 1, 1) })
})

test("the preview steps forwards and backwards through the sheets of the pages that print", async () => {
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

test("the bar of a photo picked in the preview turns only that photo", async () => {
  const { user, tap, sheet, print } = await openOptions(photo, 3)

  await tap("Nächstes Blatt")
  expect(sheet()).toBe("Foto 2/3")
  await user.click(screen.getByRole("img", { name: "Vorschau Foto 2" }))
  await tap("Nach rechts drehen")
  await tap("Schließen")
  await tap("Nächstes Blatt")
  await user.click(screen.getByRole("img", { name: "Vorschau Foto 3" }))
  await tap("Nach rechts drehen")
  await tap("Nach rechts drehen")

  expect(await print()).toMatchObject({ items: [{ count: 1, turn: 0 }, { count: 1, turn: 90 }, { count: 1, turn: 180 }] })
})

test("leaving out the picked photo closes its bar", async () => {
  const { user, tap } = await openOptions(photo, 2)

  await user.click(screen.getByRole("img", { name: "Vorschau Foto 1" }))
  expect(screen.getByRole("toolbar", { name: "Foto 1" })).toBeInTheDocument()
  await tap("Foto 1")

  expect(screen.queryByRole("toolbar", { name: "Foto 1" })).not.toBeInTheDocument()
})

/** The tiles of the strip, in order, and the one that is chosen. */
function strip() {
  const tiles = within(screen.getByRole("radiogroup", { name: "Aufteilung" })).getAllByRole("radio")
  return { names: tiles.map(tile => tile.textContent), chosen: tiles.filter(tile => tile.getAttribute("aria-checked") === "true").map(tile => tile.textContent) }
}

test("the strip offers Normal and 2× to 8×; with 2× the preview shows both halves", async () => {
  const { user, choice, sheet, print } = await openOptions(pdfOf(5))
  expect(strip()).toEqual({ names: ["Normal", "2×", "4×", "6×", "8×"], chosen: ["Normal"] })
  expect(sheet()).toBe("Seite 1 · 1/5")

  await user.click(choice("Aufteilung", "2×"))

  expect(strip().chosen).toEqual(["2×"])
  expect(sheet()).toBe("Seiten 1 und 2 · 1/3")
  expect(await screen.findByRole("img", { name: "Vorschau Seite 1" })).toBeInTheDocument()
  expect(await screen.findByRole("img", { name: "Vorschau Seite 2" })).toBeInTheDocument()
  expect(await print()).toMatchObject({ layout: { kind: "grid", perSheet: 2 }, items: items(1, 1, 1, 1, 1) })
})

test("with two pages per sheet the sheet count follows the pages that print", async () => {
  const { user, tap, choice, sheet, print } = await openOptions(pdfOf(5))
  await user.click(choice("Aufteilung", "2×"))

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
  expect(await print()).toMatchObject({ layout: { kind: "grid", perSheet: 2 }, items: items(1, 1, 1, 0, 1) })
})

test("with more pages on a sheet the line under the preview names the sheet, and the stepper goes through every sheet", async () => {
  const { user, tap, choice, sheet, print } = await openOptions(pdfOf(9))

  await user.click(choice("Aufteilung", "4×"))
  expect(sheet()).toBe("Blatt 1/3")
  expect(await screen.findByRole("img", { name: "Vorschau Seite 4" })).toBeInTheDocument()
  await tap("Nächstes Blatt")
  await tap("Nächstes Blatt")
  expect(sheet()).toBe("Seite 9 · 3/3")

  // a page brought back shows on its sheet
  await tap("Seite 6")
  await tap("Seite 6")
  expect(sheet()).toBe("Blatt 2/3")

  await user.click(choice("Aufteilung", "8×"))
  expect(sheet()).toBe("Blatt 1/2")
  await user.click(choice("Aufteilung", "6×"))
  expect(sheet()).toBe("Blatt 1/2")
  expect(await print()).toMatchObject({ layout: { kind: "grid", perSheet: 6 } })
})

test("photos share a sheet too", async () => {
  const { user, choice, sheet, print } = await openOptions(photo, 5)
  expect(strip().names.slice(0, 5)).toEqual(["Normal", "2×", "4×", "6×", "8×"])

  await user.click(choice("Aufteilung", "4×"))

  expect(sheet()).toBe("Blatt 1/2")
  expect(screen.getByRole("img", { name: "Vorschau Foto 4" })).toBeInTheDocument()
  expect(await print()).toMatchObject({ layout: { kind: "grid", perSheet: 4 }, items: items(1, 1, 1, 1, 1) })
})

test("pages per sheet are chosen on the options screen, not in the detailed controls", async () => {
  const { user } = await openOptions(pdfOf(2))

  await openDetails(user)
  expect(screen.getByRole("radiogroup", { name: "Papier" })).toBeInTheDocument()
  expect(screen.queryByText("Seiten pro Blatt")).not.toBeInTheDocument()
  await closeDetails(user)
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

test("each photo prints as often as its count: − and + under its picture, down to aus", async () => {
  const { tap, counts, thumbnails, sheet, print } = await openOptions(photo, 3)
  expect(counts("Fotos")).toEqual(["1×", "1×", "1×"])

  await tap("Foto 2 öfter")
  await tap("Foto 2 öfter")
  await tap("Foto 1 seltener")

  expect(counts("Fotos")).toEqual(["aus", "3×", "1×"])
  expect(thumbnails("Fotos").selected).toEqual(["Foto 2", "Foto 3"])
  expect(screen.getByRole("button", { name: "Foto 1 seltener" })).toBeDisabled()
  // the copies of a photo are next to each other: four sheets, the second photo on the first three
  expect(sheet()).toBe("Foto 1/4")
  // + brings a photo that is out back
  await tap("Foto 1 öfter")
  expect(counts("Fotos")).toEqual(["1×", "3×", "1×"])
  expect(await print()).toMatchObject({ items: items(1, 3, 1) })
})

test("a tap on a picture leaves its page out, and another brings it back once", async () => {
  const { tap, counts, print } = await openOptions(pdfOf(3))
  await tap("Seite 3 öfter")
  await tap("Seite 3 öfter")
  expect(counts("Seiten")).toEqual(["1×", "1×", "3×"])

  await tap("Seite 3")
  expect(counts("Seiten")).toEqual(["1×", "1×", "aus"])
  await tap("Seite 3")
  expect(counts("Seiten")).toEqual(["1×", "1×", "1×"])
  expect(await print()).toMatchObject({ items: items(1, 1, 1) })
})

test("Alle gleich brings every printed photo to one count: from mixed counts up to the highest, then together, never below 1", async () => {
  const { tap, counts, allSame, print } = await openOptions(photo, 4)
  expect(allSame()).toBe("1×")
  expect(screen.getByRole("button", { name: "Alle seltener" })).toBeDisabled()

  await tap("Alle öfter")
  expect(counts("Fotos")).toEqual(["2×", "2×", "2×", "2×"])

  await tap("Foto 1")
  await tap("Foto 3 öfter")
  expect(allSame()).toBe("≠")
  // the first tap, even on −, never lowers a count: every printed photo comes up to the highest
  await tap("Alle seltener")
  expect(counts("Fotos")).toEqual(["aus", "3×", "3×", "3×"])
  expect(allSame()).toBe("3×")
  await tap("Alle seltener")
  await tap("Alle seltener")
  await tap("Alle seltener")
  // never below 1, and a photo that is out stays out
  expect(counts("Fotos")).toEqual(["aus", "1×", "1×", "1×"])
  expect(screen.getByRole("button", { name: "Alle seltener" })).toBeDisabled()
  expect(await print()).toMatchObject({ items: items(0, 1, 1, 1) })
})

test("a count stops at 50, for one photo and for all", async () => {
  const { user, tap, counts, allSame } = await openOptions(photo, 2)

  for (let i = 0; i < 52; i++) await user.click(screen.getByRole("button", { name: "Foto 1 öfter" }))
  expect(counts("Fotos")).toEqual(["50×", "1×"])
  expect(screen.getByRole("button", { name: "Foto 1 öfter" })).toBeDisabled()

  await tap("Alle öfter")
  expect(allSame()).toBe("50×")
  expect(screen.getByRole("button", { name: "Alle öfter" })).toBeDisabled()
})

test("4 photos, 2 of each, 8 per sheet: one sheet", async () => {
  const { user, tap, choice, print } = await openOptions(photo, 4)

  await tap("Alle öfter")
  await user.click(choice("Aufteilung", "8×"))

  // one sheet: nothing to step through
  expect(screen.queryByRole("status", { name: "Blatt in der Vorschau" })).not.toBeInTheDocument()
  expect(await print()).toMatchObject({ layout: { kind: "grid", perSheet: 8 }, items: items(2, 2, 2, 2) })
})

test("a PDF of more than 30 pages has pictures that only switch pages on and off; Alle gleich counts for every page that prints", async () => {
  const { tap, counts, allSame, thumbnails, print } = await openOptions(pdfOf(31))
  expect(thumbnails("Seiten").names).toHaveLength(31)
  expect(screen.queryByRole("button", { name: "Seite 1 öfter" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Seite 1 seltener" })).not.toBeInTheDocument()

  await tap("Seite 2")
  await tap("Alle öfter")
  await tap("Alle öfter")

  expect(allSame()).toBe("3×")
  expect(counts("Seiten").slice(0, 3)).toEqual(["3×", "aus", "3×"])
  expect(await print()).toMatchObject({ items: [3, 0, ...Array.from({ length: 29 }, () => 3)].map(count => ({ count, turn: 0 })) })
})

test("in a PDF of more than 30 pages a page brought back prints as often as the others: it has no − and + of its own", async () => {
  const { tap, counts, print } = await openOptions(pdfOf(31))
  await tap("Alle öfter")
  await tap("Seite 2")
  expect(counts("Seiten").slice(0, 3)).toEqual(["2×", "aus", "2×"])

  await tap("Seite 2")

  expect(counts("Seiten").slice(0, 3)).toEqual(["2×", "2×", "2×"])
  expect(await print()).toMatchObject({ items: Array.from({ length: 31 }, () => ({ count: 2, turn: 0 })) })
})

test("a PDF of 30 pages still has a count for each page", async () => {
  await openOptions(pdfOf(30))
  expect(screen.getByRole("button", { name: "Seite 30 öfter" })).toBeInTheDocument()
})

test("a Print Job over 100 sheets can't be printed, and the screen says why", async () => {
  const { user, tap, api } = await openOptions(photo, 4)
  // 4 photos 25 times each, one per sheet: 100 sheets
  for (let i = 0; i < 24; i++) await user.click(screen.getByRole("button", { name: "Alle öfter" }))
  expect(screen.getByRole("button", { name: "Drucken" })).toBeEnabled()
  expect(screen.queryByText("Höchstens 100 Blätter pro Druck.")).not.toBeInTheDocument()

  await tap("Alle öfter")

  expect(screen.getByRole("button", { name: "Drucken" })).toBeDisabled()
  expect(screen.getByRole("alert")).toHaveTextContent("Höchstens 100 Blätter pro Druck.")
  await user.click(screen.getByRole("button", { name: "Drucken" }))
  expect(screen.queryByRole("dialog", { name: "Jetzt drucken?" })).not.toBeInTheDocument()

  // sharing sheets brings it back under the limit
  await user.click(within(screen.getByRole("radiogroup", { name: "Aufteilung" })).getByRole("radio", { name: "2×" }))
  expect(screen.getByRole("button", { name: "Drucken" })).toBeEnabled()
  expect(api.calls.filter(call => call.path === "/api/drafts/d1/submit")).toEqual([])
})

test("picking a Preset leaves which photos print and how each is turned alone", async () => {
  const { user, tap, choice, thumbnails, print } = await openOptions(photo, 3)
  await tap("Foto 1")
  await tap("Nächstes Blatt")
  await user.click(screen.getByRole("img", { name: "Vorschau Foto 3" }))
  await tap("Nach rechts drehen")

  await user.click(choice("Voreinstellung", "Foto s/w Toner sparen"))

  expect(thumbnails("Fotos").selected).toEqual(["Foto 2", "Foto 3"])
  expect(await print()).toMatchObject({ color: "mono", quality: "draft", items: [{ count: 0, turn: 0 }, { count: 1, turn: 0 }, { count: 1, turn: 90 }] })
})

test.each([
  ["a one-page PDF", pdfOf(1), 1, "Seite 1", { items: items(4) }],
  ["a single photo", photo, 1, "Foto 1", { items: items(4) }],
] as const)("%s shows no thumbnails and no sheet stepper, only how often it prints", async (_, facts, count, preview, submitted) => {
  const { tap, print } = await openOptions(facts, count)

  expect(await screen.findByRole("img", { name: `Vorschau ${preview}` })).toBeInTheDocument()
  expect(screen.queryByRole("group", { name: facts.kind === "pdf" ? "Seiten" : "Fotos" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: preview })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Alle öfter" })).not.toBeInTheDocument()
  expect(screen.queryByRole("status", { name: "Blatt in der Vorschau" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Nächstes Blatt" })).not.toBeInTheDocument()
  expect(screen.getByRole("status", { name: "Wie oft" })).toHaveTextContent("1×")
  expect(screen.getByRole("button", { name: "Seltener" })).toBeDisabled()

  await tap("Öfter")
  await tap("Öfter")
  await tap("Öfter")
  // a flyer four times: four sheets now, so the stepper shows
  expect(screen.getByRole("status", { name: "Blatt in der Vorschau" })).toHaveTextContent("1/4")
  expect(await print()).toMatchObject(submitted)
})

test("the sheet stepper hides while the pages that print fit one sheet, and the thumbnails stay", async () => {
  const { tap, thumbnails, sheet, print } = await openOptions(pdfOf(3))

  await tap("Seite 1")
  await tap("Seite 3")

  expect(screen.queryByRole("status", { name: "Blatt in der Vorschau" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Vorheriges Blatt" })).not.toBeInTheDocument()
  expect(screen.getByRole("img", { name: "Vorschau Seite 2" })).toBeInTheDocument()
  expect(thumbnails("Seiten").selected).toEqual(["Seite 2"])
  expect(screen.getByRole("button", { name: "Alle öfter" })).toBeInTheDocument()

  await tap("Seite 3")
  expect(sheet()).toBe("Seite 3 · 2/2")
  expect(await print()).toMatchObject({ items: items(0, 1, 1) })
})

test("the sheet stepper hides when two pages share the one sheet", async () => {
  const { user, choice, thumbnails } = await openOptions(pdfOf(2))
  expect(screen.getByRole("status", { name: "Blatt in der Vorschau" })).toHaveTextContent("Seite 1 · 1/2")

  await user.click(choice("Aufteilung", "2×"))

  expect(screen.queryByRole("status", { name: "Blatt in der Vorschau" })).not.toBeInTheDocument()
  expect(await screen.findByRole("img", { name: "Vorschau Seite 2" })).toBeInTheDocument()
  expect(thumbnails("Seiten").names).toEqual(["Seite 1", "Seite 2"])
})

test("a swipe to the left on the preview shows the next sheet, and one to the right the sheet before", async () => {
  const { swipe, sheet } = await openOptions(pdfOf(3))

  await swipe(-120)
  expect(sheet()).toBe("Seite 2 · 2/3")
  expect(await screen.findByRole("img", { name: "Vorschau Seite 2" })).toBeInTheDocument()
  await swipe(-120)
  expect(sheet()).toBe("Seite 3 · 3/3")

  await swipe(120)
  expect(sheet()).toBe("Seite 2 · 2/3")
})

test("a swipe past the first or the last sheet does nothing", async () => {
  const { tap, swipe, sheet } = await openOptions(pdfOf(3))

  await swipe(120)
  expect(sheet()).toBe("Seite 1 · 1/3")

  await tap("Nächstes Blatt")
  await tap("Nächstes Blatt")
  await swipe(-120)
  expect(sheet()).toBe("Seite 3 · 3/3")
})

test("only a clearly sideways swipe steps: short moves and mostly vertical ones are left to the page", async () => {
  const { swipe, sheet } = await openOptions(pdfOf(3))

  // too short
  await swipe(-40)
  // more up than sideways: the page scrolls
  await swipe(-80, -120)
  await swipe(80, 90)
  expect(sheet()).toBe("Seite 1 · 1/3")

  // a little slanted, but more sideways than up
  await swipe(-80, -50)
  expect(sheet()).toBe("Seite 2 · 2/3")
})

test("zoomed in past 100 %, a drag pans the preview and doesn't step the sheets", async () => {
  const { tap, swipe, sheet } = await openOptions(pdfOf(3))

  await tap("Ansicht vergrößern")
  await swipe(-120)
  expect(sheet()).toBe("Seite 1 · 1/3")

  await tap("Ansicht verkleinern")
  await swipe(-120)
  expect(sheet()).toBe("Seite 2 · 2/3")
})

test("photos step with a swipe too", async () => {
  const { swipe, sheet } = await openOptions(photo, 2)

  await swipe(-120)

  expect(sheet()).toBe("Foto 2/2")
  expect(screen.getByRole("img", { name: "Vorschau Foto 2" })).toHaveAttribute("src", "blob:Strand 2.jpg")
})
