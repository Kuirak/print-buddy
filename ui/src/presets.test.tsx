import { cleanup, render, screen, within } from "@solidjs/testing-library"
import { userEvent } from "@testing-library/user-event"
import { expect, test } from "vitest"
import { App } from "./App.tsx"
import { json, mockApi } from "./testing/mock-api.ts"

/** What the server finds out about the picked file: a PDF with one page, or one photo. */
const facts = {
  pdf: { kind: "pdf", pageCount: 1, pages: [{ width: 595, height: 842 }] },
  photo: { kind: "photo", format: "jpeg", width: 4000, height: 3000, orientation: 1 },
}

/** Opens the app, picks a file of the given type and waits for the options screen. */
async function openOptions(kind: "pdf" | "photo" = "pdf") {
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json(facts[kind], 201),
    "POST /api/drafts/d1/submit": () => json({ jobId: "j1", cupsJobId: 42 }, 201),
  })
  const user = userEvent.setup({ applyAccept: false })
  render(() => <App />)
  const file = kind === "pdf"
    ? new File(["%PDF-1.4"], "Rechnung.pdf", { type: "application/pdf" })
    : new File(["\xff\xd8\xff"], "Strand.jpg", { type: "image/jpeg" })
  await user.upload(screen.getByLabelText("Datei auswählen"), file)
  await screen.findByRole("button", { name: "Drucken" })

  /** Taps Drucken and returns the Print Options the app submitted. */
  async function print() {
    await user.click(screen.getByRole("button", { name: "Drucken" }))
    await screen.findByText("An den Drucker gesendet")
    return JSON.parse(api.calls.find(call => call.path === "/api/drafts/d1/submit")!.body as string) as Record<string, unknown>
  }
  const choice = (group: string, name: string) => within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name })
  const chip = (name: string) => choice("Voreinstellung", name)
  const chips = () => within(screen.getByRole("radiogroup", { name: "Voreinstellung" })).getAllByRole("radio").map(chip => chip.textContent)
  const tap = (name: string) => user.click(screen.getByRole("button", { name }))
  /** Saves the current settings as an own Preset. */
  async function saveAs(name: string) {
    await tap("Als Voreinstellung speichern …")
    await user.type(screen.getByLabelText('Name der Voreinstellung (z. B. "Bastelpapier")'), name)
    await tap("Speichern")
  }
  return { user, print, choice, chip, chips, tap, saveAs }
}

/** Closes the app and opens it again with a new file. Browser storage stays. */
function reopen(kind: "pdf" | "photo" = "pdf") {
  cleanup()
  return openOptions(kind)
}

/** Puts own Presets into browser storage, as an earlier visit would have left them. */
function stored(own: unknown[], defaults: Record<string, string> = {}) {
  localStorage.setItem("print-buddy.presets", JSON.stringify({ own, defaults }))
}

const documentMono = {
  copies: 1, color: "mono", paper: "A4", quality: "normal",
  printSize: { kind: "fit" }, position: "center", pagesPerSheet: 1,
}

test.each([
  ["pdf", "★ Dokument s/w", { color: "mono", paper: "A4", quality: "normal" }],
  ["pdf", "Dokument Farbe", { color: "color", paper: "A4", quality: "normal" }],
  ["pdf", "Umschlag DL", { color: "mono", paper: "EnvDL", quality: "normal" }],
  ["photo", "★ Foto", { color: "color", paper: "A4", quality: "normal" }],
  ["photo", "Foto s/w Toner sparen", { color: "mono", paper: "A4", quality: "draft" }],
] as const)("for a %s, tapping the built-in Preset %s sets its Print Options", async (kind, name, values) => {
  const { user, print, chip } = await openOptions(kind)

  // leave every stored field first, so the tap has to bring all of them back
  await user.click(screen.getByRole("button", { name: "Mehr Kopien" }))
  await user.click(within(screen.getByRole("radiogroup", { name: "Papier" })).getByRole("radio", { name: "A5" }))
  await user.click(chip(name))

  expect(chip(name)).toBeChecked()
  expect(await print()).toEqual({
    copies: 1, ...values,
    // the one page of the PDF, or the one photo
    printSize: { kind: "fit" }, position: "center", pagesPerSheet: 1, rotation: 0, selection: [kind === "pdf" ? 1 : 0],
  })
})

test("a new PDF starts from Dokument s/w and offers the document Presets", async () => {
  const { print, chip, chips } = await openOptions("pdf")

  expect(chips()).toEqual(["★ Dokument s/w", "Dokument Farbe", "Umschlag DL", "Eigene …"])
  expect(chip("★ Dokument s/w")).toBeChecked()
  expect(chip("Dokument Farbe")).not.toBeChecked()
  expect(chip("Eigene …")).not.toBeChecked()
  expect(await print()).toMatchObject({ color: "mono", paper: "A4", quality: "normal" })
})

test("a new photo share starts from Foto and offers the photo Presets", async () => {
  const { print, chip, chips, choice } = await openOptions("photo")

  expect(chips()).toEqual(["★ Foto", "Foto s/w Toner sparen", "Eigene …"])
  expect(chip("★ Foto")).toBeChecked()
  expect(choice("Farbe", "Farbe")).toBeChecked()
  expect(await print()).toMatchObject({ color: "color", paper: "A4", quality: "normal" })
})

test("changing an option shows Eigene until the settings match a Preset again", async () => {
  const { user, choice, chip, chips } = await openOptions()

  await user.click(choice("Qualität", "Toner sparen"))
  expect(chips()).toEqual(["★ Dokument s/w", "Dokument Farbe", "Umschlag DL", "✎ Eigene"])
  expect(chip("✎ Eigene")).toBeChecked()
  expect(chip("★ Dokument s/w")).not.toBeChecked()

  await user.click(choice("Qualität", "Normal"))
  expect(chip("★ Dokument s/w")).toBeChecked()
  expect(chip("Eigene …")).not.toBeChecked()

  await user.click(choice("Farbe", "Farbe"))
  expect(chip("Dokument Farbe")).toBeChecked()
  expect(chip("★ Dokument s/w")).not.toBeChecked()

  await user.click(screen.getByRole("button", { name: "Mehr Kopien" }))
  expect(chip("✎ Eigene")).toBeChecked()
  expect(chip("Dokument Farbe")).not.toBeChecked()
})

test("a Preset sets Print size, Position, pages per sheet and copies, and is told apart by them", async () => {
  stored([
    // rotation and selection are not part of a Preset: tapping it must not set them even if storage has them
    { id: "a", name: "Zwei auf eins", kind: "pdf", values: { ...documentMono, copies: 3, printSize: { kind: "percent", value: 85 }, position: "top-left", pagesPerSheet: 2, rotation: 90, selection: [2] } },
    { id: "b", name: "Oben", kind: "pdf", values: { ...documentMono, position: "top" } },
    { id: "c", name: "Füllen", kind: "pdf", values: { ...documentMono, printSize: { kind: "fill" } } },
    { id: "d", name: "Doppelt", kind: "pdf", values: { ...documentMono, pagesPerSheet: 2 } },
  ])
  const { user, print, choice, chip } = await openOptions()

  for (const name of ["Zwei auf eins", "Oben", "Füllen", "Doppelt", "Eigene …"]) expect(chip(name)).not.toBeChecked()
  expect(chip("★ Dokument s/w")).toBeChecked()

  // each differs from Dokument s/w in one field only, so with colour it is no longer Dokument Farbe
  for (const name of ["Oben", "Füllen", "Doppelt"]) {
    await user.click(chip(name))
    expect(chip(name)).toBeChecked()
    expect(chip("★ Dokument s/w")).not.toBeChecked()
    await user.click(choice("Farbe", "Farbe"))
    expect(chip("✎ Eigene")).toBeChecked()
  }

  await user.click(chip("Zwei auf eins"))
  expect(chip("Zwei auf eins")).toBeChecked()
  expect(chip("★ Dokument s/w")).not.toBeChecked()
  expect(screen.getByRole("status", { name: "Kopien" })).toHaveTextContent("3")

  expect(await print()).toEqual({
    ...documentMono, copies: 3, printSize: { kind: "percent", value: 85 }, position: "top-left", pagesPerSheet: 2,
    rotation: 0, selection: [1],
  })
})

test("own Presets are offered only for the file type they were saved for", async () => {
  stored([{ id: "a", name: "Brief", kind: "pdf", values: documentMono }])
  const { chips } = await openOptions("photo")

  expect(chips()).toEqual(["★ Foto", "Foto s/w Toner sparen", "Eigene …"])
})

test("the current settings can be saved as an own Preset, which is still there after reopening the app", async () => {
  const first = await openOptions()
  await first.user.click(first.choice("Papier", "A5"))
  await first.user.click(screen.getByRole("button", { name: "Mehr Kopien" }))
  expect(first.chip("✎ Eigene")).toBeChecked()

  await first.saveAs("Bastelpapier")

  expect(first.chips()).toEqual(["★ Dokument s/w", "Dokument Farbe", "Umschlag DL", "Bastelpapier", "Eigene …"])
  expect(first.chip("Bastelpapier")).toBeChecked()
  expect(screen.queryByLabelText('Name der Voreinstellung (z. B. "Bastelpapier")')).not.toBeInTheDocument()

  const { user, print, chip } = await reopen()
  expect(chip("★ Dokument s/w")).toBeChecked()
  await user.click(chip("Bastelpapier"))
  expect(chip("Bastelpapier")).toBeChecked()
  expect(await print()).toEqual({ ...documentMono, paper: "A5", copies: 2, rotation: 0, selection: [1] })
})

test("saving without a name, or backing out, saves nothing", async () => {
  const { user, tap, chips } = await openOptions()
  await user.click(screen.getByRole("button", { name: "Mehr Kopien" }))

  await tap("Als Voreinstellung speichern …")
  await tap("Speichern")
  await user.type(screen.getByLabelText('Name der Voreinstellung (z. B. "Bastelpapier")'), "   ")
  await tap("Speichern")
  await user.type(screen.getByLabelText('Name der Voreinstellung (z. B. "Bastelpapier")'), "Doch nicht")
  await tap("Abbrechen")

  expect(chips()).toEqual(["★ Dokument s/w", "Dokument Farbe", "Umschlag DL", "✎ Eigene"])
  expect((await reopen()).chips()).toEqual(["★ Dokument s/w", "Dokument Farbe", "Umschlag DL", "Eigene …"])
})

test("an own Preset can be deleted and stays deleted; the settings go back to the default Preset", async () => {
  const first = await openOptions()
  await first.user.click(first.choice("Farbe", "Farbe"))
  await first.user.click(first.choice("Papier", "A5"))
  await first.saveAs("Bastelpapier")

  await first.tap("Löschen")
  expect(screen.getByText("Voreinstellung löschen?")).toBeInTheDocument()
  await first.tap("Abbrechen")
  expect(first.chip("Bastelpapier")).toBeChecked()

  await first.tap("Löschen")
  await first.tap("Löschen")

  expect(first.chips()).toEqual(["★ Dokument s/w", "Dokument Farbe", "Umschlag DL", "Eigene …"])
  expect(first.chip("★ Dokument s/w")).toBeChecked()
  expect(first.choice("Papier", "A4")).toBeChecked()
  expect(first.choice("Farbe", "S/W")).toBeChecked()

  expect((await reopen()).chips()).toEqual(["★ Dokument s/w", "Dokument Farbe", "Umschlag DL", "Eigene …"])
})

test("built-in Presets can't be deleted, and neither can settings that match no Preset", async () => {
  const { user, chip, choice } = await openOptions()

  expect(screen.queryByRole("button", { name: "Löschen" })).not.toBeInTheDocument()
  await user.click(chip("Umschlag DL"))
  expect(screen.queryByRole("button", { name: "Löschen" })).not.toBeInTheDocument()
  await user.click(choice("Farbe", "Farbe"))
  expect(chip("✎ Eigene")).toBeChecked()
  expect(screen.queryByRole("button", { name: "Löschen" })).not.toBeInTheDocument()
})

test("a starred Preset is what new PDFs start from, also after reopening the app; photos keep their own default", async () => {
  const first = await openOptions()
  expect(screen.getByRole("button", { name: "★ Standard" })).toBeDisabled()

  await first.user.click(first.chip("Dokument Farbe"))
  await first.tap("Als Standard festlegen")

  expect(first.chips()).toEqual(["Dokument s/w", "★ Dokument Farbe", "Umschlag DL", "Eigene …"])
  expect(screen.getByRole("button", { name: "★ Standard" })).toBeDisabled()
  expect(screen.queryByRole("button", { name: "Als Standard festlegen" })).not.toBeInTheDocument()

  const second = await reopen()
  expect(second.chips()).toEqual(["Dokument s/w", "★ Dokument Farbe", "Umschlag DL", "Eigene …"])
  expect(second.chip("★ Dokument Farbe")).toBeChecked()
  expect(await second.print()).toMatchObject({ color: "color", paper: "A4" })

  const photos = await reopen("photo")
  expect(photos.chips()).toEqual(["★ Foto", "Foto s/w Toner sparen", "Eigene …"])
  expect(photos.chip("★ Foto")).toBeChecked()
})

test("photos have their own starred Preset, which can be an own one", async () => {
  const first = await openOptions("photo")
  await first.user.click(first.choice("Papier", "A5"))
  await first.saveAs("Kleines Foto")
  await first.tap("Als Standard festlegen")
  expect(first.chips()).toEqual(["Foto", "Foto s/w Toner sparen", "★ Kleines Foto", "Eigene …"])

  const photos = await reopen("photo")
  expect(photos.chip("★ Kleines Foto")).toBeChecked()
  expect(await photos.print()).toMatchObject({ color: "color", paper: "A5" })

  const pdfs = await reopen("pdf")
  expect(pdfs.chips()).toEqual(["★ Dokument s/w", "Dokument Farbe", "Umschlag DL", "Eigene …"])
})

test("the star can't be set while the settings match no Preset", async () => {
  const { user, choice } = await openOptions()

  await user.click(choice("Qualität", "Toner sparen"))

  expect(screen.queryByRole("button", { name: "Als Standard festlegen" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "★ Standard" })).not.toBeInTheDocument()
})

test("deleting the starred own Preset gives the star back to the built-in default", async () => {
  const first = await openOptions()
  await first.user.click(first.choice("Papier", "A5"))
  await first.saveAs("Bastelpapier")
  await first.tap("Als Standard festlegen")
  expect(first.chip("★ Bastelpapier")).toBeChecked()

  await first.tap("Löschen")
  await first.tap("Löschen")

  expect(first.chips()).toEqual(["★ Dokument s/w", "Dokument Farbe", "Umschlag DL", "Eigene …"])
  expect((await reopen()).chip("★ Dokument s/w")).toBeChecked()
})

test("a new file never starts from the settings of the previous Print Job", async () => {
  const first = await openOptions()
  await first.user.click(first.choice("Farbe", "Farbe"))
  await first.user.click(first.choice("Papier", "Umschlag C5"))
  await first.user.click(screen.getByRole("button", { name: "Mehr Kopien" }))
  expect(await first.print()).toMatchObject({ copies: 2, color: "color", paper: "EnvC5" })

  const second = await reopen()
  expect(second.chip("★ Dokument s/w")).toBeChecked()
  expect(await second.print()).toEqual({ ...documentMono, rotation: 0, selection: [1] })
})
