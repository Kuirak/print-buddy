import { cleanup, render, screen, within } from "@solidjs/testing-library"
import { userEvent } from "@testing-library/user-event"
import { expect, test } from "vitest"
import type { FileKind } from "../../shared/api.ts"
import { App } from "./App.tsx"
import { jobStatus } from "./testing/job-status.ts"
import { json, mockApi } from "./testing/mock-api.ts"
import { closeDetails, items, openDetails, printAndConfirm } from "./testing/options-screen.ts"

/** Opens the app, picks a file of the given type and waits for the options screen. */
async function openOptions(kind: FileKind = "pdf") {
  const facts = kind === "pdf"
    ? { kind, pageCount: 1, pages: [{ width: 595, height: 842 }] }
    : { kind, format: "jpeg", width: 4000, height: 3000, orientation: 1 }
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json(facts, 201),
    "POST /api/drafts/d1/submit": () => json({ jobId: "j1", cupsJobId: 42 }, 201),
    "GET /api/jobs/j1": () => jobStatus(),
  })
  const user = userEvent.setup({ applyAccept: false })
  render(() => <App />)
  const file = kind === "pdf"
    ? new File(["%PDF-1.4"], "Rechnung.pdf", { type: "application/pdf" })
    : new File(["\xff\xd8\xff"], "Strand.jpg", { type: "image/jpeg" })
  await user.upload(screen.getByLabelText("Datei auswählen"), file)
  await screen.findByRole("button", { name: "Drucken" })

  /** The detailed controls behind "Einstellungen", where copies, colour, paper, quality and the Preset actions are. */
  const drawer = () => screen.queryByRole("dialog", { name: "Einstellungen" })
  /** Opens the detailed controls, unless they are open. */
  async function details() {
    if (!drawer()) await openDetails(user)
  }
  /** Closes the detailed controls, if they are open: the chips and Drucken can be tapped again. */
  async function overview() {
    if (drawer()) await closeDetails(user)
  }
  /** Taps Drucken, confirms, and returns the Print Options the app submitted. */
  async function print() {
    await overview()
    await printAndConfirm(user)
    await screen.findByText("Auftrag Nr. 42")
    return JSON.parse(api.calls.find(call => call.path === "/api/drafts/d1/submit")!.body as string) as Record<string, unknown>
  }
  /** A choice in the detailed controls, which have to be open, or a chip. */
  const choice = (group: string, name: string) => within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name })
  const chip = (name: string) => choice("Voreinstellung", name)
  const chips = () => within(screen.getByRole("radiogroup", { name: "Voreinstellung" })).getAllByRole("radio").map(chip => chip.textContent)
  /** Taps a Preset chip on the options screen. */
  async function pick(name: string) {
    await overview()
    await user.click(chip(name))
  }
  /** Taps a button in the detailed controls. */
  async function tap(name: string) {
    await details()
    await user.click(within(drawer()!).getByRole("button", { name }))
  }
  /** Makes a choice in the detailed controls. */
  async function set(group: string, name: string) {
    await details()
    await user.click(choice(group, name))
  }
  /** Saves the current Print Options as an own Preset. */
  async function saveAs(name: string) {
    await tap("Als Voreinstellung speichern …")
    await user.type(screen.getByLabelText('Name der Voreinstellung (z. B. "Bastelpapier")'), name)
    await tap("Speichern")
  }
  /** Taps a tile of the strip on the options screen. */
  async function strip(name: string) {
    await overview()
    await user.click(choice("Aufteilung", name))
  }
  return { user, print, choice, chip, chips, pick, tap, set, saveAs, details, strip }
}

/** Closes the app and opens it again with a new file. Browser storage stays. */
function reopen(kind: FileKind = "pdf") {
  cleanup()
  return openOptions(kind)
}

/** Puts own Presets into browser storage, as an earlier visit would have left them. */
function stored(own: unknown[], defaults: Record<string, string> = {}) {
  localStorage.setItem("print-buddy.presets", JSON.stringify({ own, defaults }))
}

const documentMono = {
  copies: 1, color: "mono", paper: "A4", quality: "normal",
  printSize: { kind: "fit" }, position: "center", layout: { kind: "grid", perSheet: 1 },
}

const documentColor = {
  copies: 1, color: "color", paper: "A4", quality: "normal",
  printSize: { kind: "fit" }, position: "center", layout: { kind: "grid", perSheet: 1 },
}

test.each([
  ["pdf", "★ Dokument Farbe", { color: "color", paper: "A4", quality: "normal" }],
  ["pdf", "Dokument s/w", { color: "mono", paper: "A4", quality: "normal" }],
  ["pdf", "Umschlag DL", { color: "mono", paper: "EnvDL", quality: "normal" }],
  ["photo", "★ Foto", { color: "color", paper: "A4", quality: "normal" }],
  ["photo", "Foto s/w Toner sparen", { color: "mono", paper: "A4", quality: "draft" }],
] as const)("for a %s, tapping the built-in Preset %s sets its Print Options", async (kind, name, values) => {
  const { print, chip, pick, tap, set } = await openOptions(kind)

  // leave every stored field first, so the tap has to bring all of them back
  await tap("Mehr Kopien")
  await set("Papier", "A5")
  await pick(name)

  expect(chip(name)).toBeChecked()
  expect(await print()).toEqual({
    copies: 1, ...values,
    printSize: { kind: "fit" }, position: "center", layout: { kind: "grid", perSheet: 1 }, items: items(1),
  })
})

test("a new PDF starts from Dokument Farbe and offers the document Presets, colour first", async () => {
  const { print, chip, chips } = await openOptions("pdf")

  expect(chips()).toEqual(["★ Dokument Farbe", "Dokument s/w", "Umschlag DL", "Eigene …"])
  expect(chip("★ Dokument Farbe")).toBeChecked()
  expect(chip("Dokument s/w")).not.toBeChecked()
  expect(chip("Eigene …")).not.toBeChecked()
  expect(await print()).toMatchObject({ color: "color", paper: "A4", quality: "normal" })
})

test("a new photo share starts from Foto and offers the photo Presets", async () => {
  const { print, chip, chips, choice, details } = await openOptions("photo")

  expect(chips()).toEqual(["★ Foto", "Foto s/w Toner sparen", "Eigene …"])
  expect(chip("★ Foto")).toBeChecked()
  await details()
  expect(choice("Farbe", "Farbe")).toBeChecked()
  expect(await print()).toMatchObject({ color: "color", paper: "A4", quality: "normal" })
})

test("changing an option shows Eigene until the Print Options match a Preset again", async () => {
  const { set, tap, chip, chips } = await openOptions()

  await set("Qualität", "Toner sparen")
  expect(chips()).toEqual(["★ Dokument Farbe", "Dokument s/w", "Umschlag DL", "✎ Eigene"])
  expect(chip("✎ Eigene")).toBeChecked()
  expect(chip("★ Dokument Farbe")).not.toBeChecked()

  await set("Qualität", "Normal")
  expect(chip("★ Dokument Farbe")).toBeChecked()
  expect(chip("Eigene …")).not.toBeChecked()

  await set("Farbe", "S/W")
  expect(chip("Dokument s/w")).toBeChecked()
  expect(chip("★ Dokument Farbe")).not.toBeChecked()

  await tap("Mehr Kopien")
  expect(chip("✎ Eigene")).toBeChecked()
  expect(chip("Dokument s/w")).not.toBeChecked()
})

test("a Preset sets Print size, Position, the layout and copies, and is told apart by them", async () => {
  const twoPerSheet = { kind: "grid", perSheet: 2 }
  stored([
    // how often each page prints and how it is turned are not part of a Preset: tapping it must not set them even if storage has them
    { id: "a", name: "Zwei auf eins", kind: "pdf", values: { ...documentMono, copies: 3, printSize: { kind: "percent", value: 85 }, position: "top-left", layout: twoPerSheet, items: [{ count: 4, turn: 90 }] } },
    { id: "b", name: "Oben", kind: "pdf", values: { ...documentMono, position: "top" } },
    { id: "c", name: "Füllen", kind: "pdf", values: { ...documentMono, printSize: { kind: "fill" } } },
    { id: "d", name: "Doppelt", kind: "pdf", values: { ...documentMono, layout: twoPerSheet } },
  ])
  const { print, chip, pick, set, details } = await openOptions()

  for (const name of ["Zwei auf eins", "Oben", "Füllen", "Doppelt", "Eigene …"]) expect(chip(name)).not.toBeChecked()
  expect(chip("★ Dokument Farbe")).toBeChecked()

  // each differs from Dokument s/w in one field only, so with colour it is no longer Dokument Farbe
  for (const name of ["Oben", "Füllen", "Doppelt"]) {
    await pick(name)
    expect(chip(name)).toBeChecked()
    expect(chip("Dokument s/w")).not.toBeChecked()
    await set("Farbe", "Farbe")
    expect(chip("✎ Eigene")).toBeChecked()
  }

  await pick("Zwei auf eins")
  expect(chip("Zwei auf eins")).toBeChecked()
  expect(chip("Dokument s/w")).not.toBeChecked()
  await details()
  expect(screen.getByRole("status", { name: "Kopien" })).toHaveTextContent("3")

  expect(await print()).toEqual({
    ...documentMono, copies: 3, printSize: { kind: "percent", value: 85 }, position: "top-left", layout: { kind: "grid", perSheet: 2 },
    items: items(1),
  })
})

test("own Presets saved before Print Buddy knew layouts are dropped, and the built-in ones still print", async () => {
  stored([
    { id: "old", name: "Zwei auf eins", kind: "pdf", values: { ...documentMono, layout: undefined, pagesPerSheet: 2 } },
    { id: "new", name: "Oben", kind: "pdf", values: { ...documentMono, position: "top" } },
  ], { pdf: "old" })
  const { chip, chips, print } = await openOptions()

  expect(chips()).toEqual(["★ Dokument Farbe", "Dokument s/w", "Umschlag DL", "Oben", "Eigene …"])
  expect(chip("★ Dokument Farbe")).toBeChecked()
  expect(await print()).toEqual({ ...documentColor, items: items(1) })
})

test("own Presets are offered only for the file type they were saved for", async () => {
  stored([{ id: "a", name: "Brief", kind: "pdf", values: documentMono }])
  const { chips } = await openOptions("photo")

  expect(chips()).toEqual(["★ Foto", "Foto s/w Toner sparen", "Eigene …"])
})

test("the current Print Options can be saved as an own Preset, which is still there after reopening the app", async () => {
  const first = await openOptions()
  await first.strip("2×")
  await first.set("Papier", "A5")
  await first.tap("Mehr Kopien")
  expect(first.chip("✎ Eigene")).toBeChecked()

  await first.saveAs("Bastelpapier")

  expect(first.chips()).toEqual(["★ Dokument Farbe", "Dokument s/w", "Umschlag DL", "Bastelpapier", "Eigene …"])
  expect(first.chip("Bastelpapier")).toBeChecked()
  expect(screen.queryByLabelText('Name der Voreinstellung (z. B. "Bastelpapier")')).not.toBeInTheDocument()

  const { user, print, chip } = await reopen()
  expect(chip("★ Dokument Farbe")).toBeChecked()
  await user.click(chip("Bastelpapier"))
  expect(chip("Bastelpapier")).toBeChecked()
  expect(await print()).toEqual({ ...documentColor, paper: "A5", copies: 2, layout: { kind: "grid", perSheet: 2 }, items: items(1) })
})

test("saving without a name, or backing out, saves nothing", async () => {
  const { user, tap, chips } = await openOptions()
  await tap("Mehr Kopien")

  await tap("Als Voreinstellung speichern …")
  await tap("Speichern")
  await user.type(screen.getByLabelText('Name der Voreinstellung (z. B. "Bastelpapier")'), "   ")
  await tap("Speichern")
  await user.type(screen.getByLabelText('Name der Voreinstellung (z. B. "Bastelpapier")'), "Doch nicht")
  await tap("Abbrechen")

  expect(chips()).toEqual(["★ Dokument Farbe", "Dokument s/w", "Umschlag DL", "✎ Eigene"])
  expect((await reopen()).chips()).toEqual(["★ Dokument Farbe", "Dokument s/w", "Umschlag DL", "Eigene …"])
})

test("an own Preset can be deleted and stays deleted; the Print Options go back to the default Preset", async () => {
  const first = await openOptions()
  await first.set("Farbe", "S/W")
  await first.set("Papier", "A5")
  await first.saveAs("Bastelpapier")

  await first.tap("Löschen")
  expect(screen.getByText("Voreinstellung löschen?")).toBeInTheDocument()
  await first.tap("Abbrechen")
  expect(first.chip("Bastelpapier")).toBeChecked()

  await first.tap("Löschen")
  await first.tap("Löschen")

  expect(first.chips()).toEqual(["★ Dokument Farbe", "Dokument s/w", "Umschlag DL", "Eigene …"])
  expect(first.chip("★ Dokument Farbe")).toBeChecked()
  expect(first.choice("Papier", "A4")).toBeChecked()
  expect(first.choice("Farbe", "Farbe")).toBeChecked()

  expect((await reopen()).chips()).toEqual(["★ Dokument Farbe", "Dokument s/w", "Umschlag DL", "Eigene …"])
})

test("built-in Presets can't be deleted, and neither can Print Options that match no Preset", async () => {
  const { chip, pick, set, details } = await openOptions()

  await details()
  expect(screen.getByRole("button", { name: "★ Standard" })).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Löschen" })).not.toBeInTheDocument()
  await pick("Umschlag DL")
  await details()
  expect(screen.queryByRole("button", { name: "Löschen" })).not.toBeInTheDocument()
  await set("Farbe", "Farbe")
  expect(chip("✎ Eigene")).toBeChecked()
  expect(screen.getByRole("button", { name: "Als Voreinstellung speichern …" })).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Löschen" })).not.toBeInTheDocument()
})

test("a starred Preset is what new PDFs start from, also after reopening the app; photos keep their own default", async () => {
  const first = await openOptions()
  await first.details()
  expect(screen.getByRole("button", { name: "★ Standard" })).toBeDisabled()

  await first.pick("Dokument s/w")
  await first.tap("Als Standard festlegen")

  expect(first.chips()).toEqual(["Dokument Farbe", "★ Dokument s/w", "Umschlag DL", "Eigene …"])
  expect(screen.getByRole("button", { name: "★ Standard" })).toBeDisabled()
  expect(screen.queryByRole("button", { name: "Als Standard festlegen" })).not.toBeInTheDocument()

  const second = await reopen()
  expect(second.chips()).toEqual(["Dokument Farbe", "★ Dokument s/w", "Umschlag DL", "Eigene …"])
  expect(second.chip("★ Dokument s/w")).toBeChecked()
  expect(await second.print()).toMatchObject({ color: "mono", paper: "A4" })

  const photos = await reopen("photo")
  expect(photos.chips()).toEqual(["★ Foto", "Foto s/w Toner sparen", "Eigene …"])
  expect(photos.chip("★ Foto")).toBeChecked()
})

test("photos have their own starred Preset, which can be an own one", async () => {
  const first = await openOptions("photo")
  await first.set("Papier", "A5")
  await first.saveAs("Kleines Foto")
  await first.tap("Als Standard festlegen")
  expect(first.chips()).toEqual(["Foto", "Foto s/w Toner sparen", "★ Kleines Foto", "Eigene …"])

  const photos = await reopen("photo")
  expect(photos.chip("★ Kleines Foto")).toBeChecked()
  expect(await photos.print()).toMatchObject({ color: "color", paper: "A5" })

  const pdfs = await reopen("pdf")
  expect(pdfs.chips()).toEqual(["★ Dokument Farbe", "Dokument s/w", "Umschlag DL", "Eigene …"])
})

test("the star can't be set while the Print Options match no Preset", async () => {
  const { set } = await openOptions()

  await set("Qualität", "Toner sparen")

  expect(screen.getByRole("button", { name: "Als Voreinstellung speichern …" })).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Als Standard festlegen" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "★ Standard" })).not.toBeInTheDocument()
})

test("deleting the starred own Preset gives the star back to the built-in default", async () => {
  const first = await openOptions()
  await first.set("Papier", "A5")
  await first.saveAs("Bastelpapier")
  await first.tap("Als Standard festlegen")
  expect(first.chip("★ Bastelpapier")).toBeChecked()

  await first.tap("Löschen")
  await first.tap("Löschen")

  expect(first.chips()).toEqual(["★ Dokument Farbe", "Dokument s/w", "Umschlag DL", "Eigene …"])
  expect((await reopen()).chip("★ Dokument Farbe")).toBeChecked()
})

test("a new file never starts from the Print Options of the previous Print Job", async () => {
  const first = await openOptions()
  await first.set("Farbe", "S/W")
  await first.set("Papier", "Umschlag C5")
  await first.tap("Mehr Kopien")
  expect(await first.print()).toMatchObject({ copies: 2, color: "mono", paper: "EnvC5" })

  const second = await reopen()
  expect(second.chip("★ Dokument Farbe")).toBeChecked()
  expect(await second.print()).toEqual({ ...documentColor, items: items(1) })
})
