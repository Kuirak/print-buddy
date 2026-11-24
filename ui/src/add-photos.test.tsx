import { render, screen, within } from "@solidjs/testing-library"
import { userEvent } from "@testing-library/user-event"
import { expect, test } from "vitest"
import type { FileFacts } from "../../shared/api.ts"
import { App } from "./App.tsx"
import { phoneFiles } from "./phone-files.ts"
import { jpegFile } from "./testing/files.ts"
import { json, mockApi, type ApiCall } from "./testing/mock-api.ts"
import { laidOut, printAndConfirm } from "./testing/options-screen.ts"

const photo: FileFacts = { kind: "photo", format: "jpeg", width: 4000, height: 3000, orientation: 1 }

const uploaded = (calls: readonly ApiCall[]) =>
  calls.filter(call => call.path === "/api/drafts/d1/files").map(call => ((call.body as FormData).get("file") as File).name)

/** Opens the app with these photos picked, laid out from the server's facts. */
async function openPhotos(...names: string[]) {
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json(photo, 201),
    "POST /api/drafts/d1/submit": () => json({ jobId: "j1", cupsJobId: 42 }, 201),
  })
  const user = userEvent.setup({ applyAccept: false })
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), names.map(name => jpegFile(name, 4000, 3000)))
  await laidOut()
  return { api, user }
}

/** The photos in the preview, in the order they sit on the sheet, by the phone's file they show. */
const inPreview = () =>
  within(screen.getByRole("region", { name: "Vorschau" })).getAllByRole("img").map(picture => picture.getAttribute("src"))

test("photos added to a loaded print come after the ones there, which keep what was chosen for them", async () => {
  const { api, user } = await openPhotos("Strand 1.jpg", "Strand 2.jpg")
  await user.click(within(screen.getByRole("radiogroup", { name: "Aufteilung" })).getByRole("radio", { name: "8×" }))
  await user.click(screen.getByRole("button", { name: "Foto 1 öfter" }))
  expect(inPreview()).toEqual(["blob:Strand 1.jpg", "blob:Strand 1.jpg", "blob:Strand 2.jpg"])

  await user.upload(screen.getByLabelText("Fotos hinzufügen"), [jpegFile("Strand 3.jpg", 4000, 3000), jpegFile("Strand 4.jpg", 4000, 3000)])
  await laidOut()

  // the photos there stay first, with their counts and the layout; the new ones follow, printed once
  expect(inPreview()).toEqual(["blob:Strand 1.jpg", "blob:Strand 1.jpg", "blob:Strand 2.jpg", "blob:Strand 3.jpg", "blob:Strand 4.jpg"])
  expect(screen.getByRole("status", { name: "Wie oft Foto 1" })).toHaveTextContent("2×")
  expect(within(screen.getByRole("radiogroup", { name: "Aufteilung" })).getByRole("radio", { name: "8×" })).toBeChecked()
  // only the new photos are uploaded, into the same draft
  expect(api.calls.filter(call => call.path === "/api/drafts")).toHaveLength(1)
  expect(uploaded(api.calls)).toEqual(["Strand 1.jpg", "Strand 2.jpg", "Strand 3.jpg", "Strand 4.jpg"])
  expect((await phoneFiles.held()).map(file => file.name)).toEqual(["Strand 1.jpg", "Strand 2.jpg", "Strand 3.jpg", "Strand 4.jpg"])

  await printAndConfirm(user)
  await screen.findByText("Auftrag Nr. 42")
  const sent = JSON.parse(api.calls.find(call => call.path === "/api/drafts/d1/submit")!.body as string) as { items: unknown; layout: unknown }
  expect(sent.items).toEqual([{ count: 2, turn: 0 }, { count: 1, turn: 0 }, { count: 1, turn: 0 }, { count: 1, turn: 0 }])
  expect(sent.layout).toEqual({ kind: "grid", perSheet: 8 })
})

test("more photos than a Print Job holds are not added", async () => {
  const { api, user } = await openPhotos(...Array.from({ length: 19 }, (_, index) => `Strand ${index + 1}.jpg`))

  await user.upload(screen.getByLabelText("Fotos hinzufügen"), [jpegFile("A.jpg", 40, 30), jpegFile("B.jpg", 40, 30)])

  expect(screen.getByRole("alert")).toHaveTextContent("Höchstens 20 Fotos auf einmal: noch 1 möglich.")
  expect(uploaded(api.calls)).toHaveLength(19)
  expect(screen.getAllByRole("button", { name: /^Foto \d+$/ })).toHaveLength(19)
})
