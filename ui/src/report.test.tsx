import { setTimeout as sleep } from "node:timers/promises"
import { cleanup, render, screen, within } from "@solidjs/testing-library"
import { userEvent, type UserEvent } from "@testing-library/user-event"
import { afterEach, expect, test, vi } from "vitest"
import type { ReportFacts } from "../../shared/api.ts"
import { App } from "./App.tsx"
import { StatusScreen } from "./screens/StatusScreen.tsx"
import { jobStatus, sentAt } from "./testing/job-status.ts"
import { json, mockApi, type ApiHandler } from "./testing/mock-api.ts"
import { closeDetails, openDetails, printAndConfirm } from "./testing/options-screen.ts"

const chromeOnAndroid = "Mozilla/5.0 (Linux; Android 17; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.7204.63 Mobile Safari/537.36"

const reportFacts: ReportFacts = { version: "2026.11.1", printer: { state: "idle", reasons: ["none"], message: "" } }
const pdfFacts = { kind: "pdf", pageCount: 1, pages: [{ width: 595, height: 842 }] }

/** A PDF whose name and contents must never show up in a report. */
const secretPdf = () => new File(["%PDF-1.4 streng geheim"], "Kündigung Anna.pdf", { type: "application/pdf" })
const secrets = /Kündigung|Anna|geheim|%PDF/

/** The server for one Print Job `j1` from draft `d1`, changed by `routes`. */
const printing = (routes: Record<string, ApiHandler> = {}) => mockApi({
  "POST /api/drafts": () => json({ draftId: "d1" }, 201),
  "POST /api/drafts/d1/files": () => json(pdfFacts, 201),
  "POST /api/drafts/d1/submit": () => json({ jobId: "j1", cupsJobId: 42 }, 201),
  "GET /api/jobs/j1": () => jobStatus(),
  "GET /api/report": () => reportFacts,
  ...routes,
})

/** Taps "Bericht kopieren" and gives what is on the clipboard once the app says it copied. */
async function copyReport(user: UserEvent) {
  await user.click(await screen.findByRole("button", { name: "Bericht kopieren" }))
  expect(await screen.findByRole("status")).toHaveTextContent("Kopiert")
  return await navigator.clipboard.readText()
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test("Bericht kopieren on Fehler copies the whole report as plain text and says Kopiert", async () => {
  vi.useFakeTimers({ now: sentAt + 5 * 60_000 })
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(chromeOnAndroid)
  mockApi({
    "GET /api/jobs/j1": () => jobStatus({
      state: "error",
      reason: "Kein Papier im Drucker.",
      endedAt: sentAt + 75_000,
      details: { jobState: "aborted", jobStateReasons: ["aborted-by-system"], printerStateReasons: ["media-empty-error"], printerMessage: "Out of paper." },
      sheets: 4,
      file: { kind: "pdf", bytes: 48_213, count: 3 },
      options: {
        copies: 2, color: "mono", paper: "A4", quality: "normal",
        printSize: { kind: "percent", value: 80 }, position: "top-left", pagesPerSheet: 1, rotation: 90, selection: [1, 3],
      },
    }),
    "GET /api/report": () => ({ version: "2026.11.1", printer: { state: "stopped", reasons: ["media-empty-error", "paused"], message: "Out of paper." } }),
  })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  render(() => <StatusScreen job={{ jobId: "j1", cupsJobId: 42 }} onClose={() => {}} onPrintAgain={() => {}} />)
  await vi.advanceTimersByTimeAsync(0)
  expect(screen.getByRole("heading")).toHaveTextContent("Fehler")
  expect(screen.queryByRole("status")).not.toBeInTheDocument()

  await user.click(screen.getByRole("button", { name: "Bericht kopieren" }))
  await vi.advanceTimersByTimeAsync(0)

  expect(screen.getByRole("status")).toHaveTextContent("Kopiert")
  expect(await navigator.clipboard.readText()).toBe([
    "Print Buddy Bericht",
    "Erstellt: 2026-11-19T08:35:00.000Z",
    "",
    "Zustand: Fehler",
    "Grund: Kein Papier im Drucker.",
    "Gesendet: 2026-11-19T08:30:00.000Z",
    "Beendet: 2026-11-19T08:31:15.000Z",
    "Dauer: 75 s",
    "CUPS-Auftrag Nr.: 42",
    "CUPS-Zustand: aborted",
    "CUPS-Gründe: aborted-by-system",
    "Drucker-Gründe beim Auftrag: media-empty-error",
    "Drucker-Meldung beim Auftrag: Out of paper.",
    "Blätter: 4",
    "",
    "Drucker jetzt: stopped",
    "Drucker-Gründe: media-empty-error, paused",
    "Drucker-Meldung: Out of paper.",
    "",
    "Dateityp: PDF",
    "Größe: 48213 Bytes",
    "Seiten: 3",
    "",
    "Druckoptionen:",
    "  copies: 2",
    "  color: mono",
    "  paper: A4",
    "  quality: normal",
    '  printSize: {"kind":"percent","value":80}',
    "  position: top-left",
    "  pagesPerSheet: 1",
    "  rotation: 90",
    "  selection: [1,3]",
    "",
    "Print Buddy: 2026.11.1",
    "Chrome: 153.0.7204.63",
  ].join("\n"))
})

test("the report of a Print Job that still runs says so, and counts photos as photos", async () => {
  printing({
    "GET /api/jobs/j1": () => jobStatus({ state: "printing", file: { kind: "photo", bytes: 5_000_000, count: 2 } }),
  })
  const user = userEvent.setup()
  render(() => <StatusScreen job={{ jobId: "j1", cupsJobId: 42 }} onClose={() => {}} onPrintAgain={() => {}} />)
  await screen.findByRole("heading", { name: "Wird gedruckt" })

  const report = await copyReport(user)

  expect(report).toContain("Zustand: Wird gedruckt\nGesendet: 2026-11-19T08:30:00.000Z\nBeendet: noch nicht\nCUPS-Auftrag Nr.: 42\n")
  expect(report).toContain("Drucker-Gründe beim Auftrag: –\nDrucker-Meldung beim Auftrag: –\n")
  expect(report).toContain("Dateityp: Foto\nGröße: 5000000 Bytes\nFotos: 2\n")
  expect(report).not.toContain("Dauer")
})

test("the report of a Print Job never holds the file name or anything from the file", async () => {
  printing()
  const user = userEvent.setup()
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), secretPdf())
  expect(await screen.findByText("Kündigung Anna.pdf")).toBeInTheDocument()
  await printAndConfirm(user)
  await screen.findByRole("heading", { name: "Wartet" })

  const report = await copyReport(user)

  expect(report).toContain("CUPS-Auftrag Nr.: 42")
  expect(report).not.toMatch(secrets)
})

test("Bericht kopieren on the Refusal screen says what was refused, with the file's type and size and never its name", async () => {
  printing({ "POST /api/drafts/d1/files": () => json({ refusal: "too-large", limitMb: 50 }, 413) })
  const user = userEvent.setup()
  render(() => <App />)
  const file = secretPdf()
  await user.upload(screen.getByLabelText("Datei auswählen"), file)
  await screen.findByText("Die Datei ist zu groß (höchstens 50 MB).")

  const report = await copyReport(user)

  expect(report).toContain("Was passiert ist: Die Datei wurde abgelehnt: Die Datei ist zu groß (höchstens 50 MB).\n")
  expect(report).toContain(`Dateityp: application/pdf\nGröße: ${file.size} Bytes\nDateien: 1\n`)
  expect(report).toContain("Drucker jetzt: idle\n")
  expect(report).toContain("Print Buddy: 2026.11.1\n")
  expect(report).not.toContain("CUPS-Auftrag")
  expect(report).not.toMatch(secrets)
})

test("Bericht kopieren on Drucken hat nicht geklappt says what the server answered, with the Print Options and never the file name", async () => {
  printing({ "POST /api/drafts/d1/submit": () => json({ error: "cups-unreachable" }, 502) })
  const user = userEvent.setup()
  render(() => <App />)
  const file = secretPdf()
  await user.upload(screen.getByLabelText("Datei auswählen"), file)
  await openDetails(user)
  await user.click(screen.getByRole("button", { name: "Mehr Kopien" }))
  await closeDetails(user)
  await printAndConfirm(user)
  await screen.findByRole("heading", { name: "Drucken hat nicht geklappt" })

  const report = await copyReport(user)

  expect(report).toContain("Was passiert ist: Der Druckauftrag konnte nicht gesendet werden: Der Server antwortete mit 502 (cups-unreachable).\n")
  expect(report).toContain(`Dateityp: application/pdf\nGröße: ${file.size} Bytes\nDateien: 1\n`)
  expect(report).toContain("Druckoptionen:\n  copies: 2\n")
  expect(report).toContain("\n  color: color\n")
  expect(report).not.toContain("CUPS-Auftrag")
  expect(report).not.toMatch(secrets)
})

test("when the server can't be reached at all, the report still copies and says so", async () => {
  const unreachable = () => { throw new TypeError("Failed to fetch") }
  printing({ "POST /api/drafts/d1/submit": unreachable, "GET /api/report": unreachable })
  const user = userEvent.setup()
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), secretPdf())
  await printAndConfirm(user)
  await screen.findByRole("heading", { name: "Drucken hat nicht geklappt" })

  const report = await copyReport(user)

  expect(report).toContain("Was passiert ist: Der Druckauftrag konnte nicht gesendet werden: Der Server war nicht erreichbar.\n")
  expect(report).toContain("Drucker jetzt: unbekannt (Server nicht erreichbar)\n")
  expect(report).toContain("Print Buddy: unbekannt (Server nicht erreichbar)\n")
  expect(report).not.toMatch(secrets)
})

test("when the phone won't let the app write to the clipboard, the app says that copying didn't work", async () => {
  printing()
  const user = userEvent.setup()
  render(() => <StatusScreen job={{ jobId: "j1", cupsJobId: 42 }} onClose={() => {}} onPrintAgain={() => {}} />)
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new DOMException("Write permission denied.", "NotAllowedError"))

  await user.click(await screen.findByRole("button", { name: "Bericht kopieren" }))

  expect(await screen.findByRole("status")).toHaveTextContent("Kopieren hat nicht geklappt")
})

test("a browser that isn't Chrome is named by what it says it is", async () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Android 17; Mobile; rv:150.0) Gecko/150.0 Firefox/150.0")
  printing()
  const user = userEvent.setup()
  render(() => <StatusScreen job={{ jobId: "j1", cupsJobId: 42 }} onClose={() => {}} onPrintAgain={() => {}} />)

  const report = await copyReport(user)

  expect(report).toMatch(/\nBrowser: Mozilla\/5\.0 \(Android 17; Mobile; rv:150\.0\) Gecko\/150\.0 Firefox\/150\.0$/)
})

test("Start shows the last Print Job from this phone with its current state, also after the app was closed, and copies its report", async () => {
  const api = printing()
  const user = userEvent.setup()
  render(() => <App />)
  expect(screen.queryByText(/Letzter Druck/)).not.toBeInTheDocument()
  await user.upload(screen.getByLabelText("Datei auswählen"), secretPdf())
  await printAndConfirm(user)
  await screen.findByRole("heading", { name: "Wartet" })

  // the person closes the app while the job waits, and opens it again when the Printer is done
  cleanup()
  api.on("GET /api/jobs/j1", () => jobStatus({ state: "done", endedAt: sentAt + 75_000 }))
  render(() => <App />)

  expect(await screen.findByText("Letzter Druck: Fertig")).toBeInTheDocument()
  expect(screen.getByLabelText("Datei auswählen")).toBeInTheDocument()
  const report = await copyReport(user)
  expect(report).toContain("Zustand: Fertig\nGesendet: 2026-11-19T08:30:00.000Z\nBeendet: 2026-11-19T08:31:15.000Z\nDauer: 75 s\nCUPS-Auftrag Nr.: 42\n")
  expect(report).not.toMatch(secrets)
})

test("only the last Print Job is kept on the phone, and nothing about its file", async () => {
  let drafts = 0
  const api = printing({
    "POST /api/drafts": () => json({ draftId: `d${++drafts}` }, 201),
    "GET /api/jobs/j1": () => jobStatus({ state: "done", endedAt: sentAt + 75_000 }),
    "POST /api/drafts/d2/files": () => json(pdfFacts, 201),
    "POST /api/drafts/d2/submit": () => json({ jobId: "j2", cupsJobId: 43 }, 201),
    "GET /api/jobs/j2": () => jobStatus({ jobId: "j2", cupsJobId: 43, state: "error", reason: "Papierstau im Drucker.", endedAt: sentAt + 90_000 }),
  })
  const user = userEvent.setup()
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), secretPdf())
  await printAndConfirm(user)
  await user.click(await screen.findByRole("button", { name: "Nochmal drucken" }))
  await user.click(within(screen.getByRole("dialog", { name: "Nochmal drucken?" })).getByRole("button", { name: "Drucken" }))
  await screen.findByRole("heading", { name: "Fehler" })

  await user.click(screen.getByRole("button", { name: "Schließen" }))

  expect(await screen.findByText("Letzter Druck: Fehler")).toBeInTheDocument()
  const stored = Object.values({ ...localStorage }).join("\n")
  expect(stored).toContain("j2")
  expect(stored).not.toContain("j1")
  expect(stored).not.toMatch(secrets)
  const reads = api.calls.filter(call => call.method === "GET").map(call => call.path)
  expect(reads.at(-1)).toBe("/api/jobs/j2")
})

test("a last Print Job the server no longer has leaves Start without the line, for good", async () => {
  const api = printing()
  const user = userEvent.setup()
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), secretPdf())
  await printAndConfirm(user)
  await screen.findByRole("heading", { name: "Wartet" })

  // more than 7 days later the job folder is gone
  cleanup()
  let asked = 0
  api.on("GET /api/jobs/j1", () => {
    asked++
    return json({ error: "not-found" }, 404)
  })
  render(() => <App />)
  await vi.waitFor(() => expect(asked).toBe(1))
  await sleep(20)
  expect(screen.queryByText(/Letzter Druck/)).not.toBeInTheDocument()

  cleanup()
  render(() => <App />)
  await screen.findByLabelText("Datei auswählen")
  await sleep(20)

  expect(screen.queryByText(/Letzter Druck/)).not.toBeInTheDocument()
  expect(asked).toBe(1)
})

test("while the server can't say how the last Print Job is doing, Start still offers its report", async () => {
  const api = printing()
  const user = userEvent.setup()
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), secretPdf())
  await printAndConfirm(user)
  await screen.findByRole("heading", { name: "Wartet" })

  cleanup()
  api.on("GET /api/jobs/j1", () => { throw new TypeError("Failed to fetch") })
  render(() => <App />)

  expect(await screen.findByText("Letzter Druck: unbekannt")).toBeInTheDocument()
  const report = await copyReport(user)
  expect(report).toContain("Zustand: unbekannt (der Auftrag konnte nicht gelesen werden)\nCUPS-Auftrag Nr.: 42\n")
})
