import { render, screen } from "@solidjs/testing-library"
import { userEvent } from "@testing-library/user-event"
import { expect, test } from "vitest"
import { App } from "./App.tsx"
import { phoneFiles } from "./phone-files.ts"
import { receiveShare } from "./share-target.ts"
import { jobStatus, sentAt } from "./testing/job-status.ts"
import { json, mockApi } from "./testing/mock-api.ts"
import { printAndConfirm } from "./testing/options-screen.ts"
import { share } from "./testing/share.ts"

const pdf = (name: string) => new File(["%PDF-1.4"], name, { type: "application/pdf" })
const photo = (name: string) => new File(["\xff\xd8\xff"], name, { type: "image/jpeg" })
const names = async () => (await phoneFiles.held()).map(file => file.name)

test("files chosen with Datei auswählen stay on the phone through Drucken", async () => {
  mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json({ kind: "photo", format: "jpeg", width: 4000, height: 3000, orientation: 1 }, 201),
    "POST /api/drafts/d1/submit": () => json({ jobId: "j1", cupsJobId: 42 }, 201),
    "GET /api/jobs/j1": () => jobStatus(),
  })
  const user = userEvent.setup()
  render(() => <App />)

  await user.upload(screen.getByLabelText("Datei auswählen"), [photo("IMG_2.jpg"), photo("IMG_1.jpg")])
  await screen.findByText("2 Fotos")
  expect(await names()).toEqual(["IMG_2.jpg", "IMG_1.jpg"])

  await printAndConfirm(user)
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

test.each([
  ["an empty body", { "Content-Type": "multipart/form-data; boundary=----share" }],
  ["a body that is no form", { "Content-Type": "text/plain" }],
])("a share with %s leaves nothing on the phone, not even an earlier job's files", async (_what, headers) => {
  await phoneFiles.keep([pdf("Gestern.pdf")])
  // Chrome 153 on Android 17 can deliver a share without its files (crbug 563075800)
  const request = new Request(new URL("/share-target", location.href), { method: "POST", headers, body: "" })

  const response = await receiveShare(request)

  expect(response.status).toBe(303)
  expect(response.headers.get("Location")).toBe("/?shared=1")
  expect(await names()).toEqual([])
})

/** Two drafts: the first is submitted as job `j1`, which has ended; printing again makes `j2`. */
const printTwiceRoutes = () => {
  let drafts = 0
  return {
    "POST /api/drafts": () => json({ draftId: `d${++drafts}` }, 201),
    "POST /api/drafts/d1/files": () => json({ kind: "pdf", pageCount: 1, pages: [{ width: 595, height: 842 }] }, 201),
    "POST /api/drafts/d1/submit": () => json({ jobId: "j1", cupsJobId: 42 }, 201),
    "GET /api/jobs/j1": () => jobStatus({ state: "done", endedAt: sentAt + 75_000 }),
    "POST /api/drafts/d2/files": () => json({ kind: "pdf", pageCount: 1, pages: [{ width: 595, height: 842 }] }, 201),
    "POST /api/drafts/d2/submit": () => json({ jobId: "j2", cupsJobId: 43 }, 201),
    "GET /api/jobs/j2": () => jobStatus({ jobId: "j2", cupsJobId: 43, state: "done", endedAt: sentAt + 75_000 }),
  }
}

test("Nochmal drucken uploads the shared file again from the phone's copy, which goes when the person taps Schließen", async () => {
  const api = mockApi(printTwiceRoutes())
  const user = userEvent.setup()
  await share([new File(["%PDF-1.4 shared"], "Rechnung.pdf", { type: "application/pdf" })])
  render(() => <App />)
  await printAndConfirm(user)
  await screen.findByRole("heading", { name: "Fertig" })
  expect(await names()).toEqual(["Rechnung.pdf"])

  await user.click(screen.getByRole("button", { name: "Nochmal drucken" }))

  await screen.findByText("Auftrag Nr. 43")
  const again = api.calls.find(call => call.path === "/api/drafts/d2/files")!.body as FormData
  expect(again.get("file")).toBe((await phoneFiles.held())[0])
  expect(await (again.get("file") as File).text()).toBe("%PDF-1.4 shared")
  expect(await names()).toEqual(["Rechnung.pdf"])

  await user.click(await screen.findByRole("button", { name: "Schließen" }))

  expect(screen.getByLabelText("Datei auswählen")).toBeInTheDocument()
  await expect.poll(names).toEqual([])
})

test("Erneut versuchen uploads the picked photos again from the phone's copy", async () => {
  let drafts = 0
  const photoFacts = { kind: "photo", format: "jpeg", width: 4000, height: 3000, orientation: 1 }
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: `d${++drafts}` }, 201),
    "POST /api/drafts/d1/files": () => json(photoFacts, 201),
    "POST /api/drafts/d1/submit": () => json({ error: "cups-unreachable" }, 502),
    "POST /api/drafts/d2/files": () => json(photoFacts, 201),
    "POST /api/drafts/d2/submit": () => json({ jobId: "j1", cupsJobId: 42 }, 201),
    "GET /api/jobs/j1": () => jobStatus(),
  })
  const user = userEvent.setup()
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), [photo("IMG_2.jpg"), photo("IMG_1.jpg")])
  await printAndConfirm(user)
  await screen.findByRole("heading", { name: "Drucken hat nicht geklappt" })
  expect(await names()).toEqual(["IMG_2.jpg", "IMG_1.jpg"])

  await user.click(screen.getByRole("button", { name: "Erneut versuchen" }))

  await screen.findByText("Auftrag Nr. 42")
  const again = api.calls.filter(call => call.path === "/api/drafts/d2/files").map(call => (call.body as FormData).get("file"))
  expect(again).toEqual(await phoneFiles.held())
  expect(await names()).toEqual(["IMG_2.jpg", "IMG_1.jpg"])
})

test("when the phone no longer holds the files, Nochmal drucken says Bitte nochmal teilen and sends nothing", async () => {
  const api = mockApi(printTwiceRoutes())
  const user = userEvent.setup()
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), pdf("Rechnung.pdf"))
  await printAndConfirm(user)
  await screen.findByRole("heading", { name: "Fertig" })
  // the browser may drop the phone's storage, for example when the phone runs out of space
  await phoneFiles.clear()

  await user.click(screen.getByRole("button", { name: "Nochmal drucken" }))

  expect(await screen.findByRole("heading", { name: "Bitte nochmal teilen" })).toBeInTheDocument()
  expect(screen.getByLabelText("Datei auswählen")).toBeInTheDocument()
  expect(api.calls.filter(call => call.method === "POST").map(call => call.path)).toEqual([
    "/api/drafts",
    "/api/drafts/d1/files",
    "/api/drafts/d1/submit",
  ])
})

test("Schließen on Drucken hat nicht geklappt leads back to Start, and the phone forgets the file", async () => {
  mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json({ kind: "pdf", pageCount: 1, pages: [{ width: 595, height: 842 }] }, 201),
    "POST /api/drafts/d1/submit": () => json({ error: "cups-unreachable" }, 502),
  })
  const user = userEvent.setup()
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), pdf("Rechnung.pdf"))
  await printAndConfirm(user)
  await screen.findByRole("heading", { name: "Drucken hat nicht geklappt" })
  expect(await names()).toEqual(["Rechnung.pdf"])

  await user.click(screen.getByRole("button", { name: "Schließen" }))

  expect(screen.getByRole("heading", { name: "Print Buddy" })).toBeInTheDocument()
  expect(screen.getByLabelText("Datei auswählen")).toBeInTheDocument()
  await expect.poll(names).toEqual([])
})
