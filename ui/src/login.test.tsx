import { setTimeout as sleep } from "node:timers/promises"
import { cleanup, render, screen, within } from "@solidjs/testing-library"
import { userEvent } from "@testing-library/user-event"
import { expect, onTestFinished, test, vi } from "vitest"
import { App } from "./App.tsx"
import { phoneFiles } from "./phone-files.ts"
import { jobStatus, sentAt } from "./testing/job-status.ts"
import { logInAgain, loginExpired } from "./testing/login.ts"
import { json, mockApi } from "./testing/mock-api.ts"
import { closeDetails, items, openDetails, printAndConfirm, shownSettings } from "./testing/options-screen.ts"
import { share } from "./testing/share.ts"

test("the app asks the session check when it opens, and a 401 shows Anmeldung abgelaufen with Neu anmelden", async () => {
  const api = mockApi({ "GET /api/session": loginExpired })

  render(() => <App />)

  expect(await screen.findByRole("heading", { name: "Anmeldung abgelaufen" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Neu anmelden" })).toBeInTheDocument()
  expect(screen.queryByLabelText("Datei auswählen")).not.toBeInTheDocument()
  expect(api.calls.map(call => `${call.method} ${call.path}`)).toEqual(["GET /api/session"])
  expect(api.calls[0]!.headers.get("X-Requested-With")).toBe("XMLHttpRequest")
})

test("Neu anmelden leaves the app for a full page load of the login address", async () => {
  mockApi({ "GET /api/session": loginExpired })
  // stands in for the browser, which would leave the page here
  const pageLoad = vi.spyOn(location, "assign").mockImplementation(() => {})
  onTestFinished(() => pageLoad.mockRestore())
  const user = userEvent.setup()
  render(() => <App />)

  await user.click(await screen.findByRole("button", { name: "Neu anmelden" }))

  expect(pageLoad).toHaveBeenCalledExactlyOnceWith("/login")
})

const pdfFacts = { kind: "pdf", pageCount: 1, pages: [{ width: 595, height: 842 }] }
const pdf = (name: string) => new File(["%PDF-1.4 ", name], name, { type: "application/pdf" })

test("a 401 while a picked file is on its way to the server shows Anmeldung abgelaufen", async () => {
  mockApi({ "POST /api/drafts": loginExpired })
  const user = userEvent.setup()
  render(() => <App />)

  await user.upload(screen.getByLabelText("Datei auswählen"), pdf("Rechnung.pdf"))

  expect(await screen.findByRole("heading", { name: "Anmeldung abgelaufen" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Neu anmelden" })).toBeInTheDocument()
})

test("a 401 when the person taps Drucken shows Anmeldung abgelaufen, not Drucken hat nicht geklappt", async () => {
  mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json(pdfFacts, 201),
    "POST /api/drafts/d1/submit": loginExpired,
  })
  const user = userEvent.setup()
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), pdf("Rechnung.pdf"))

  await printAndConfirm(user)

  expect(await screen.findByRole("heading", { name: "Anmeldung abgelaufen" })).toBeInTheDocument()
  expect(screen.queryByRole("heading", { name: "Drucken hat nicht geklappt" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Erneut versuchen" })).not.toBeInTheDocument()
})

const choice = (group: string, name: string) => within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name })

test("after the login the options screen opens with the same file and the same Print Options, and Drucken sends them", async () => {
  let drafts = 0
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: `d${++drafts}` }, 201),
    "POST /api/drafts/d1/files": () => json(pdfFacts, 201),
    "POST /api/drafts/d1/submit": loginExpired,
    "POST /api/drafts/d2/files": () => json(pdfFacts, 201),
    "POST /api/drafts/d2/submit": () => json({ jobId: "j1", cupsJobId: 42 }, 201),
    "GET /api/jobs/j1": () => jobStatus(),
  })
  const user = userEvent.setup()
  const file = pdf("Rechnung.pdf")
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), file)
  await openDetails(user)
  await user.click(screen.getByRole("button", { name: "Mehr Kopien" }))
  await user.click(choice("Farbe", "Farbe"))
  await user.click(choice("Papier", "A5"))
  await user.click(choice("Qualität", "Toner sparen"))
  await closeDetails(user)
  await printAndConfirm(user)
  await screen.findByRole("heading", { name: "Anmeldung abgelaufen" })

  await logInAgain(user)
  render(() => <App />)

  expect(await screen.findByText("Rechnung.pdf")).toBeInTheDocument()
  expect(await shownSettings(user)).toEqual({ copies: "2", color: "Farbe", paper: "A5", quality: "Toner sparen" })
  // the file comes from the phone's copy: nobody shared or picked it again
  expect((api.calls.find(call => call.path === "/api/drafts/d2/files")!.body as FormData).get("file")).toBe(file)
  // a reload must not take this for another return from the login
  expect(location.search).toBe("")

  await printAndConfirm(user)

  expect(await screen.findByText("Auftrag Nr. 42")).toBeInTheDocument()
  expect(JSON.parse(api.calls.find(call => call.path === "/api/drafts/d2/submit")!.body as string)).toEqual({
    copies: 2, color: "color", paper: "A5", quality: "draft",
    printSize: { kind: "fit" }, position: "center", layout: { kind: "grid", perSheet: 1 }, items: items(1),
  })
  expect((await phoneFiles.held()).map(held => held.name)).toEqual(["Rechnung.pdf"])
})

test("when the phone's copy is gone after the login, the app says Bitte nochmal teilen and offers Datei auswählen", async () => {
  let drafts = 0
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: `d${++drafts}` }, 201),
    "POST /api/drafts/d1/files": () => json(pdfFacts, 201),
    "POST /api/drafts/d1/submit": loginExpired,
    "POST /api/drafts/d2/files": () => json(pdfFacts, 201),
  })
  const user = userEvent.setup()
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), pdf("Rechnung.pdf"))
  await openDetails(user)
  await user.click(screen.getByRole("button", { name: "Mehr Kopien" }))
  await closeDetails(user)
  await printAndConfirm(user)
  await screen.findByRole("heading", { name: "Anmeldung abgelaufen" })
  // the browser may drop the phone's storage while the person is away at the login
  await phoneFiles.clear()

  await logInAgain(user)
  render(() => <App />)

  expect(await screen.findByRole("heading", { name: "Bitte nochmal teilen" })).toBeInTheDocument()
  expect(api.calls.filter(call => call.method === "POST").map(call => call.path)).toEqual([
    "/api/drafts",
    "/api/drafts/d1/files",
    "/api/drafts/d1/submit",
  ])

  // the file picked now is a new one: it doesn't get the Print Options of the lost one
  await user.upload(screen.getByLabelText("Datei auswählen"), pdf("Neu.pdf"))

  expect(await screen.findByText("Neu.pdf")).toBeInTheDocument()
  expect((await shownSettings(user)).copies).toBe("1")
})

test("a share that went to the server, as one lost to the login does, says Bitte nochmal teilen and never opens what an earlier job left", async () => {
  const api = mockApi({})
  // the person closed the app in the middle of yesterday's job
  await phoneFiles.keep([pdf("Gestern.pdf")])
  // where the server sends the browser from /share-target (server/share-target.test.ts)
  history.replaceState(null, "", "/?shared=lost")

  render(() => <App />)

  expect(screen.getByRole("heading", { name: "Bitte nochmal teilen" })).toBeInTheDocument()
  expect(screen.getByLabelText("Datei auswählen")).toBeInTheDocument()
  await expect.poll(() => phoneFiles.held()).toEqual([])
  expect(api.calls.map(call => `${call.method} ${call.path}`)).toEqual(["GET /api/session"])
  expect(location.search).toBe("")
})

test("a 401 while the status screen follows a Print Job shows Anmeldung abgelaufen, and the login leads back to the status of the same Print Job", async () => {
  // the clock runs by itself, and the test can skip ahead to the next poll
  vi.useFakeTimers({ shouldAdvanceTime: true })
  onTestFinished(() => { vi.useRealTimers() })
  let loggedIn = true
  let drafts = 0
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: `d${++drafts}` }, 201),
    "POST /api/drafts/d1/files": () => json(pdfFacts, 201),
    "POST /api/drafts/d1/submit": () => json({ jobId: "j1", cupsJobId: 42 }, 201),
    "GET /api/jobs/j1": () => (loggedIn ? jobStatus() : loginExpired()),
    "POST /api/drafts/d2/files": () => json(pdfFacts, 201),
    "POST /api/drafts/d2/submit": () => json({ jobId: "j2", cupsJobId: 43 }, 201),
    "GET /api/jobs/j2": () => jobStatus({ jobId: "j2", cupsJobId: 43 }),
  })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  const file = pdf("Rechnung.pdf")
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), file)
  await openDetails(user)
  await user.click(screen.getByRole("button", { name: "Mehr Kopien" }))
  await closeDetails(user)
  await printAndConfirm(user)
  await screen.findByRole("heading", { name: "Wartet" })

  loggedIn = false
  await vi.advanceTimersByTimeAsync(2_000)

  expect(await screen.findByRole("heading", { name: "Anmeldung abgelaufen" })).toBeInTheDocument()
  // the app asks the server nothing more while the person has to log in
  const asked = api.calls.length
  await vi.advanceTimersByTimeAsync(10_000)
  expect(api.calls).toHaveLength(asked)

  loggedIn = true
  await logInAgain(user)
  render(() => <App />)

  expect(await screen.findByRole("heading", { name: "Wartet" })).toBeInTheDocument()
  expect(screen.getByText("Auftrag Nr. 42")).toBeInTheDocument()
  expect(location.search).toBe("")
  // the same Print Job: nothing was uploaded or sent a second time
  expect(api.calls.filter(call => call.method === "POST").map(call => call.path)).toEqual([
    "/api/drafts",
    "/api/drafts/d1/files",
    "/api/drafts/d1/submit",
  ])

  // and the app goes on following it
  api.on("GET /api/jobs/j1", () => jobStatus({ state: "done", endedAt: sentAt + 75_000 }))
  await vi.advanceTimersByTimeAsync(2_000)
  expect(await screen.findByRole("heading", { name: "Fertig" })).toBeInTheDocument()

  // Nochmal drucken still has the file and the Print Options
  await user.click(screen.getByRole("button", { name: "Nochmal drucken" }))
  await user.click(within(screen.getByRole("dialog", { name: "Nochmal drucken?" })).getByRole("button", { name: "Drucken" }))

  expect(await screen.findByText("Auftrag Nr. 43")).toBeInTheDocument()
  expect((api.calls.find(call => call.path === "/api/drafts/d2/files")!.body as FormData).get("file")).toBe(file)
  expect(JSON.parse(api.calls.find(call => call.path === "/api/drafts/d2/submit")!.body as string)).toMatchObject({ copies: 2, items: items(1) })
})

test("back on the status screen after the login, läuft seit still counts from when the Print Job was sent", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  onTestFinished(() => { vi.useRealTimers() })
  let loggedIn = true
  mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json(pdfFacts, 201),
    "POST /api/drafts/d1/submit": () => json({ jobId: "j1", cupsJobId: 42 }, 201),
    "GET /api/jobs/j1": () => (loggedIn ? jobStatus() : loginExpired()),
  })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), pdf("Rechnung.pdf"))
  await printAndConfirm(user)
  await screen.findByRole("heading", { name: "Wartet" })
  loggedIn = false
  await vi.advanceTimersByTimeAsync(2_000)
  await screen.findByRole("heading", { name: "Anmeldung abgelaufen" })

  // the PIN comes by email, so the login takes a while
  await vi.advanceTimersByTimeAsync(70_000)
  loggedIn = true
  await logInAgain(user)
  render(() => <App />)

  expect(await screen.findByText(/^läuft seit 1:1\d$/)).toBeInTheDocument()
  expect(screen.getByText("Schläft der Drucker oder ist er aus? Der Auftrag wartet weiter.")).toBeInTheDocument()
})

test("a share that arrives while the login has run out is still on the phone after the login, and the options screen opens with it", async () => {
  let loggedIn = false
  const api = mockApi({
    "GET /api/session": () => (loggedIn ? { ok: true } : loginExpired()),
    "POST /api/drafts": () => (loggedIn ? json({ draftId: "d1" }, 201) : loginExpired()),
    "POST /api/drafts/d1/files": () => json(pdfFacts, 201),
  })
  const user = userEvent.setup()
  await share([pdf("Rechnung.pdf")])
  render(() => <App />)
  await screen.findByRole("heading", { name: "Anmeldung abgelaufen" })

  loggedIn = true
  await logInAgain(user)
  render(() => <App />)

  expect(await screen.findByText("Rechnung.pdf")).toBeInTheDocument()
  expect(await screen.findByRole("button", { name: "Drucken" })).toBeInTheDocument()
  const uploaded = (api.calls.find(call => call.path === "/api/drafts/d1/files")!.body as FormData).get("file") as File
  expect(uploaded.name).toBe("Rechnung.pdf")
  expect(await uploaded.text()).toBe("%PDF-1.4 Rechnung.pdf")
})

test("when the login ran out with no job in progress, the login leads back to Start", async () => {
  let loggedIn = false
  mockApi({ "GET /api/session": () => (loggedIn ? { ok: true } : loginExpired()) })
  const user = userEvent.setup()
  render(() => <App />)
  await screen.findByRole("heading", { name: "Anmeldung abgelaufen" })

  loggedIn = true
  await logInAgain(user)
  render(() => <App />)

  expect(screen.getByRole("heading", { name: "Print Buddy" })).toBeInTheDocument()
  expect(screen.getByLabelText("Datei auswählen")).toBeInTheDocument()
  expect(location.search).toBe("")
})

test("when the login runs out on the Refusal screen, the login leads back to Start, because a refused file is no job to come back to", async () => {
  mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json({ refusal: "too-large", limitMb: 50 }, 413),
    // what Bericht kopieren asks the server
    "GET /api/report": loginExpired,
  })
  const user = userEvent.setup()
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), pdf("Rechnung.pdf"))
  await screen.findByText("Die Datei ist zu groß (höchstens 50 MB).")
  await user.click(screen.getByRole("button", { name: "Bericht kopieren" }))
  await screen.findByRole("heading", { name: "Anmeldung abgelaufen" })

  await logInAgain(user)
  render(() => <App />)

  expect(screen.getByLabelText("Datei auswählen")).toBeInTheDocument()
  await sleep(20)
  expect(screen.getByRole("heading", { name: "Print Buddy" })).toBeInTheDocument()
})

/** Picks a PDF, asks for two copies and taps Drucken, which is when the login turns out to have run out. */
async function loseLoginAtDrucken() {
  mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json(pdfFacts, 201),
    "POST /api/drafts/d1/submit": loginExpired,
  })
  const user = userEvent.setup()
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), pdf("Rechnung.pdf"))
  await openDetails(user)
  await user.click(screen.getByRole("button", { name: "Mehr Kopien" }))
  await closeDetails(user)
  await printAndConfirm(user)
  await screen.findByRole("heading", { name: "Anmeldung abgelaufen" })
}

test("closing the app on Anmeldung abgelaufen leaves the job: opened again, the app is on Start and has forgotten it", async () => {
  await loseLoginAtDrucken()

  // the person closes the app without logging in, and opens it again later
  cleanup()
  render(() => <App />)

  expect(screen.getByLabelText("Datei auswählen")).toBeInTheDocument()
  await expect.poll(() => phoneFiles.held()).toEqual([])

  // a login from here on has no job to go back to
  cleanup()
  history.replaceState(null, "", "/?logged-in=1")
  render(() => <App />)

  expect(screen.getByRole("heading", { name: "Print Buddy" })).toBeInTheDocument()
  expect(screen.getByLabelText("Datei auswählen")).toBeInTheDocument()
})

test("a file shared after the login ran out on another one starts with its own Print Options", async () => {
  await loseLoginAtDrucken()

  // the person closes the app without logging in, and later shares another file
  cleanup()
  await share([pdf("Neu.pdf")])
  render(() => <App />)

  expect(await screen.findByText("Neu.pdf")).toBeInTheDocument()
  expect((await shownSettings(userEvent.setup())).copies).toBe("1")
})
