import { render, screen } from "@solidjs/testing-library"
import { userEvent } from "@testing-library/user-event"
import { expect, test } from "vitest"
import { App } from "./App.tsx"
import { phoneFiles } from "./phone-files.ts"
import { json, mockApi } from "./testing/mock-api.ts"
import { share } from "./testing/share.ts"

const pdf = (name: string) => new File(["%PDF-1.4"], name, { type: "application/pdf" })
const photo = (name: string) => new File(["\xff\xd8\xff"], name, { type: "image/jpeg" })
const names = async () => (await phoneFiles.held()).map(file => file.name)

test("files chosen with Datei auswählen stay on the phone through Drucken", async () => {
  mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json({ kind: "photo", format: "jpeg", width: 4000, height: 3000, orientation: 1 }, 201),
    "POST /api/drafts/d1/submit": () => json({ jobId: "j1", cupsJobId: 42 }, 201),
  })
  const user = userEvent.setup()
  render(() => <App />)

  await user.upload(screen.getByLabelText("Datei auswählen"), [photo("IMG_2.jpg"), photo("IMG_1.jpg")])
  await screen.findByText("2 Fotos")
  expect(await names()).toEqual(["IMG_2.jpg", "IMG_1.jpg"])

  await user.click(screen.getByRole("button", { name: "Drucken" }))
  await screen.findByText("Auftrag Nr. 42")
  expect(await names()).toEqual(["IMG_2.jpg", "IMG_1.jpg"])
})

test("shared files stay on the phone after the app has opened with them", async () => {
  mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json({ kind: "pdf", pageCount: 1, pages: [{ width: 595, height: 842 }] }, 201),
  })

  await share([pdf("Rechnung.pdf")])
  render(() => <App />)

  await screen.findByText("Rechnung.pdf")
  expect(await names()).toEqual(["Rechnung.pdf"])
})

test("picking another file replaces the phone's copy", async () => {
  mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json({ refusal: "unsupported-type" }, 415),
  })
  const user = userEvent.setup()
  await share([pdf("Alt.pdf")])
  render(() => <App />)
  await screen.findByText("Diese Datei kann Print Buddy nicht drucken. Möglich sind PDF, JPG und PNG.")

  mockApi({
    "POST /api/drafts": () => json({ draftId: "d2" }, 201),
    "POST /api/drafts/d2/files": () => json({ kind: "pdf", pageCount: 1, pages: [{ width: 595, height: 842 }] }, 201),
  })
  await user.upload(screen.getByLabelText("Datei auswählen"), pdf("Neu.pdf"))

  await screen.findByText("Neu.pdf")
  expect(await names()).toEqual(["Neu.pdf"])
})

test("a refused set of files is not kept on the phone", async () => {
  mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json({ refusal: "one-pdf-only" }, 409),
  })
  const user = userEvent.setup()
  render(() => <App />)

  await user.upload(screen.getByLabelText("Datei auswählen"), [pdf("a.pdf"), pdf("b.pdf")])

  await screen.findByText("Bitte jeweils nur eine Datei teilen")
  expect(await names()).toEqual([])
})

test("opening the app directly drops what an earlier job left on the phone", async () => {
  mockApi({})
  await phoneFiles.keep([pdf("Gestern.pdf")])

  render(() => <App />)

  expect(await screen.findByLabelText("Datei auswählen")).toBeInTheDocument()
  await expect.poll(names).toEqual([])
})
