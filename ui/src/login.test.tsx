import { render, screen, within } from "@solidjs/testing-library"
import { userEvent } from "@testing-library/user-event"
import { expect, onTestFinished, test, vi } from "vitest"
import { App } from "./App.tsx"
import { phoneFiles } from "./phone-files.ts"
import { jobStatus } from "./testing/job-status.ts"
import { logInAgain, loginExpired } from "./testing/login.ts"
import { json, mockApi } from "./testing/mock-api.ts"

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

  await user.click(await screen.findByRole("button", { name: "Drucken" }))

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
  await user.click(await screen.findByRole("button", { name: "Mehr Kopien" }))
  await user.click(choice("Farbe", "Farbe"))
  await user.click(choice("Papier", "A5"))
  await user.click(choice("Qualität", "Toner sparen"))
  await user.click(screen.getByRole("button", { name: "Drucken" }))
  await screen.findByRole("heading", { name: "Anmeldung abgelaufen" })

  await logInAgain(user)
  render(() => <App />)

  expect(await screen.findByText("Rechnung.pdf")).toBeInTheDocument()
  expect(screen.getByRole("status", { name: "Kopien" })).toHaveTextContent("2")
  expect(choice("Farbe", "Farbe")).toBeChecked()
  expect(choice("Papier", "A5")).toBeChecked()
  expect(choice("Qualität", "Toner sparen")).toBeChecked()
  // the file comes from the phone's copy: nobody shared or picked it again
  expect((api.calls.find(call => call.path === "/api/drafts/d2/files")!.body as FormData).get("file")).toBe(file)
  // a reload must not take this for another return from the login
  expect(location.search).toBe("")

  await user.click(screen.getByRole("button", { name: "Drucken" }))

  expect(await screen.findByText("Auftrag Nr. 42")).toBeInTheDocument()
  expect(JSON.parse(api.calls.find(call => call.path === "/api/drafts/d2/submit")!.body as string)).toEqual({
    copies: 2, color: "color", paper: "A5", quality: "draft",
    printSize: { kind: "fit" }, position: "center", pagesPerSheet: 1, rotation: 0, selection: [1],
  })
  expect((await phoneFiles.held()).map(held => held.name)).toEqual(["Rechnung.pdf"])
})
