import { render, screen, within } from "@solidjs/testing-library"
import { userEvent } from "@testing-library/user-event"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { StatusScreen } from "./screens/StatusScreen.tsx"
import { jobStatus, sentAt } from "./testing/job-status.ts"
import { json, mockApi, type ApiCall } from "./testing/mock-api.ts"

/** How often the app has asked the server about job `j1`. */
const reads = (calls: ApiCall[]) => calls.filter(call => call.method === "GET" && call.path === "/api/jobs/j1").length

function renderStatusScreen() {
  render(() => <StatusScreen job={{ jobId: "j1", cupsJobId: 42 }} onClose={() => {}} onPrintAgain={() => {}} />)
}

beforeEach(() => {
  vi.useFakeTimers({ now: sentAt })
})

afterEach(() => {
  vi.useRealTimers()
})

test("the status screen follows the Print Job every 2 s and stops asking once it has ended", async () => {
  let answer = jobStatus()
  const api = mockApi({ "GET /api/jobs/j1": () => answer })
  renderStatusScreen()

  await vi.advanceTimersByTimeAsync(0)
  expect(screen.getByRole("heading")).toHaveTextContent("Wartet")
  expect(screen.getByText("Auftrag Nr. 42")).toBeInTheDocument()
  expect(reads(api.calls)).toBe(1)

  await vi.advanceTimersByTimeAsync(1_999)
  expect(reads(api.calls)).toBe(1)

  answer = jobStatus({ state: "printing" })
  await vi.advanceTimersByTimeAsync(1)
  expect(reads(api.calls)).toBe(2)
  expect(screen.getByRole("heading")).toHaveTextContent("Wird gedruckt")

  answer = jobStatus({ state: "done", endedAt: sentAt + 4_000 })
  await vi.advanceTimersByTimeAsync(2_000)
  expect(reads(api.calls)).toBe(3)
  expect(screen.getByRole("heading")).toHaveTextContent("Fertig")

  await vi.advanceTimersByTimeAsync(60_000)
  expect(reads(api.calls)).toBe(3)
})

test("a timer runs while the Print Job runs, and Fertig shows how long it took", async () => {
  let answer = jobStatus()
  mockApi({ "GET /api/jobs/j1": () => answer })
  renderStatusScreen()

  await vi.advanceTimersByTimeAsync(0)
  expect(screen.getByText("läuft seit 0:00")).toBeInTheDocument()

  await vi.advanceTimersByTimeAsync(42_000)
  expect(screen.getByText("läuft seit 0:42")).toBeInTheDocument()

  answer = jobStatus({ state: "printing" })
  await vi.advanceTimersByTimeAsync(31_000)
  expect(screen.getByRole("heading")).toHaveTextContent("Wird gedruckt")
  expect(screen.getByText("läuft seit 1:13")).toBeInTheDocument()

  answer = jobStatus({ state: "done", endedAt: sentAt + 75_000 })
  await vi.advanceTimersByTimeAsync(2_000)
  expect(screen.getByText("gedauert 1:15")).toBeInTheDocument()
  expect(screen.queryByText(/läuft seit/)).not.toBeInTheDocument()

  await vi.advanceTimersByTimeAsync(30_000)
  expect(screen.getByText("gedauert 1:15")).toBeInTheDocument()
})

test("Abbrechen is offered while the Print Job waits or prints, and while it prints a hint says what may still come out", async () => {
  let answer = jobStatus()
  mockApi({ "GET /api/jobs/j1": () => answer })
  renderStatusScreen()
  const hint = "Was der Drucker schon hat, kann noch herauskommen."

  await vi.advanceTimersByTimeAsync(0)
  expect(screen.getByRole("button", { name: "Abbrechen" })).toBeInTheDocument()
  expect(screen.queryByText(hint)).not.toBeInTheDocument()

  answer = jobStatus({ state: "printing" })
  await vi.advanceTimersByTimeAsync(2_000)
  expect(screen.getByRole("heading")).toHaveTextContent("Wird gedruckt")
  expect(screen.getByRole("button", { name: "Abbrechen" })).toBeInTheDocument()
  expect(screen.getByText(hint)).toBeInTheDocument()

  answer = jobStatus({ state: "done", endedAt: sentAt + 4_000 })
  await vi.advanceTimersByTimeAsync(2_000)
  expect(screen.getByRole("heading")).toHaveTextContent("Fertig")
  expect(screen.queryByRole("button", { name: "Abbrechen" })).not.toBeInTheDocument()
  expect(screen.queryByText(hint)).not.toBeInTheDocument()
})

test("tapping Abbrechen cancels the Print Job, and the screen shows Abgebrochen", async () => {
  const api = mockApi({
    "GET /api/jobs/j1": () => jobStatus(),
    "POST /api/jobs/j1/cancel": () => jobStatus({ state: "cancelled", endedAt: sentAt + 1_000 }),
  })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  renderStatusScreen()
  await vi.advanceTimersByTimeAsync(1_000)

  await user.click(screen.getByRole("button", { name: "Abbrechen" }))

  expect(screen.getByRole("heading")).toHaveTextContent("Abgebrochen")
  expect(screen.queryByRole("button", { name: "Abbrechen" })).not.toBeInTheDocument()
  expect(screen.queryByText(/läuft seit/)).not.toBeInTheDocument()
  expect(api.calls.filter(call => call.path === "/api/jobs/j1/cancel")).toHaveLength(1)

  const asked = reads(api.calls)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(reads(api.calls)).toBe(asked)
  expect(screen.getByRole("heading")).toHaveTextContent("Abgebrochen")
})

test("tapping Abbrechen while the Print Job prints cancels it, and the screen shows Abgebrochen", async () => {
  const api = mockApi({
    "GET /api/jobs/j1": () => jobStatus({ state: "printing" }),
    "POST /api/jobs/j1/cancel": () => jobStatus({ state: "cancelled", endedAt: sentAt + 3_000 }),
  })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  renderStatusScreen()
  await vi.advanceTimersByTimeAsync(0)
  expect(screen.getByRole("heading")).toHaveTextContent("Wird gedruckt")

  await user.click(screen.getByRole("button", { name: "Abbrechen" }))

  expect(screen.getByRole("heading")).toHaveTextContent("Abgebrochen")
  expect(screen.queryByRole("button", { name: "Abbrechen" })).not.toBeInTheDocument()
  expect(api.calls.filter(call => call.path === "/api/jobs/j1/cancel")).toHaveLength(1)
})

test("when the cancel comes too late, the screen shows where the Print Job is now", async () => {
  let answer = jobStatus({ state: "printing" })
  mockApi({
    "GET /api/jobs/j1": () => answer,
    "POST /api/jobs/j1/cancel": () => json({ error: "not-cancellable" }, 409),
  })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  renderStatusScreen()
  await vi.advanceTimersByTimeAsync(0)

  answer = jobStatus({ state: "done", endedAt: sentAt + 4_000 })
  await user.click(screen.getByRole("button", { name: "Abbrechen" }))
  await vi.advanceTimersByTimeAsync(2_000)

  expect(screen.getByRole("heading")).toHaveTextContent("Fertig")
  expect(screen.queryByRole("button", { name: "Abbrechen" })).not.toBeInTheDocument()
})

test("after 60 s in Wartet a hint asks whether the Printer is asleep or off, and the job keeps waiting", async () => {
  let answer = jobStatus()
  const api = mockApi({ "GET /api/jobs/j1": () => answer })
  renderStatusScreen()
  const hint = "Schläft der Drucker oder ist er aus? Der Auftrag wartet weiter."

  await vi.advanceTimersByTimeAsync(59_000)
  expect(screen.getByText("läuft seit 0:59")).toBeInTheDocument()
  expect(screen.queryByText(hint)).not.toBeInTheDocument()

  await vi.advanceTimersByTimeAsync(1_000)
  expect(screen.getByText(hint)).toBeInTheDocument()
  expect(screen.getByRole("heading")).toHaveTextContent("Wartet")
  expect(screen.getByRole("button", { name: "Abbrechen" })).toBeInTheDocument()

  const asked = reads(api.calls)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(reads(api.calls)).toBe(asked + 5)
  expect(screen.getByText("läuft seit 1:10")).toBeInTheDocument()
  expect(screen.getByText(hint)).toBeInTheDocument()

  answer = jobStatus({ state: "printing" })
  await vi.advanceTimersByTimeAsync(2_000)
  expect(screen.getByRole("heading")).toHaveTextContent("Wird gedruckt")
  expect(screen.queryByText(hint)).not.toBeInTheDocument()
})

test("Schließen and Nochmal drucken are offered once the Print Job has ended, not before", async () => {
  let answer = jobStatus()
  mockApi({ "GET /api/jobs/j1": () => answer })
  renderStatusScreen()

  await vi.advanceTimersByTimeAsync(0)
  expect(screen.queryByRole("button", { name: "Schließen" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Nochmal drucken" })).not.toBeInTheDocument()

  answer = jobStatus({ state: "printing" })
  await vi.advanceTimersByTimeAsync(2_000)
  expect(screen.queryByRole("button", { name: "Schließen" })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Nochmal drucken" })).not.toBeInTheDocument()

  answer = jobStatus({ state: "cancelled", endedAt: sentAt + 4_000 })
  await vi.advanceTimersByTimeAsync(2_000)
  expect(screen.getByRole("heading")).toHaveTextContent("Abgebrochen")
  expect(screen.getByRole("button", { name: "Schließen" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Nochmal drucken" })).toBeInTheDocument()
})

test("a failed Print Job shows Fehler with the German reason", async () => {
  mockApi({
    "GET /api/jobs/j1": () => jobStatus({ state: "error", reason: "Beim Drucken ist ein Fehler aufgetreten.", endedAt: sentAt + 9_000 }),
  })
  const onClose = vi.fn()
  const onPrintAgain = vi.fn()
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  render(() => <StatusScreen job={{ jobId: "j1", cupsJobId: 42 }} onClose={onClose} onPrintAgain={onPrintAgain} />)

  await vi.advanceTimersByTimeAsync(0)
  expect(screen.getByRole("heading")).toHaveTextContent("Fehler")
  expect(screen.getByText("Beim Drucken ist ein Fehler aufgetreten.")).toBeInTheDocument()
  expect(screen.queryByText(/läuft seit|gedauert/)).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Abbrechen" })).not.toBeInTheDocument()

  await user.click(screen.getByRole("button", { name: "Nochmal drucken" }))
  expect(onPrintAgain).not.toHaveBeenCalled()
  await user.click(within(screen.getByRole("dialog", { name: "Nochmal drucken?" })).getByRole("button", { name: "Drucken" }))
  expect(onPrintAgain).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "Schließen" }))
  expect(onClose).toHaveBeenCalledTimes(1)
})

test("Nochmal drucken asks first and says what will come out; Abbrechen in it prints nothing", async () => {
  mockApi({
    "GET /api/jobs/j1": () => jobStatus({
      state: "done",
      endedAt: sentAt + 9_000,
      sheets: 6,
      file: { kind: "photo", bytes: 9_000, count: 3 },
      options: {
        copies: 2, color: "color", paper: "A4", quality: "draft",
        printSize: { kind: "fill" }, position: "center", layout: { kind: "grid", perSheet: 1 }, items: [{ count: 1, turn: 0 }, { count: 1, turn: 0 }, { count: 1, turn: 0 }],
      },
    }),
  })
  const onPrintAgain = vi.fn()
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  render(() => <StatusScreen job={{ jobId: "j1", cupsJobId: 42 }} onClose={() => {}} onPrintAgain={onPrintAgain} />)
  await vi.advanceTimersByTimeAsync(0)

  await user.click(screen.getByRole("button", { name: "Nochmal drucken" }))

  const dialog = screen.getByRole("dialog", { name: "Nochmal drucken?" })
  expect(within(dialog).getByRole("heading")).toHaveTextContent("Nochmal drucken?")
  expect(within(dialog).getAllByRole("listitem").map(line => line.textContent)).toEqual([
    "3 Fotos × 2 Kopien = 6 Blätter",
    "Farbe · A4 · Füllen · Toner sparen",
  ])

  await user.click(within(dialog).getByRole("button", { name: "Abbrechen" }))
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  expect(screen.getByRole("heading")).toHaveTextContent("Fertig")
  expect(onPrintAgain).not.toHaveBeenCalled()
})

test("Nochmal drucken names the pages of a PDF as the confirmation does", async () => {
  mockApi({
    "GET /api/jobs/j1": () => jobStatus({
      state: "cancelled",
      endedAt: sentAt + 9_000,
      sheets: 2,
      file: { kind: "pdf", bytes: 9_000, count: 5 },
      options: {
        copies: 1, color: "mono", paper: "A5", quality: "normal",
        printSize: { kind: "percent", value: 71 }, position: "center", layout: { kind: "grid", perSheet: 2 },
        items: [{ count: 1, turn: 0 }, { count: 1, turn: 0 }, { count: 0, turn: 0 }, { count: 1, turn: 0 }, { count: 0, turn: 0 }],
      },
    }),
  })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  renderStatusScreen()
  await vi.advanceTimersByTimeAsync(0)

  await user.click(screen.getByRole("button", { name: "Nochmal drucken" }))

  expect(within(screen.getByRole("dialog", { name: "Nochmal drucken?" })).getAllByRole("listitem").map(line => line.textContent)).toEqual([
    "3 Seiten (1-2, 4; 2 pro Blatt) × 1 Kopie = 2 Blätter",
    "Schwarz-Weiß · A5 · 71 %",
  ])
})

test("Fehler has Details, closed at first, with what CUPS said and the CUPS job number", async () => {
  mockApi({
    "GET /api/jobs/j1": () => jobStatus({
      state: "error",
      reason: "Kein Papier im Drucker.",
      endedAt: sentAt + 9_000,
      details: {
        jobState: "aborted",
        jobStateReasons: ["aborted-by-system"],
        printerStateReasons: ["media-empty-error"],
        printerMessage: "Job aborted after 5 unsuccessful attempts.",
      },
    }),
  })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  renderStatusScreen()
  await vi.advanceTimersByTimeAsync(0)

  expect(screen.getByText("Kein Papier im Drucker.")).toBeInTheDocument()
  const details = screen.getByRole("button", { name: "Details" })
  expect(details).toHaveAttribute("aria-expanded", "false")
  expect(screen.queryByText("Job aborted after 5 unsuccessful attempts.")).not.toBeInTheDocument()

  await user.click(details)

  expect(details).toHaveAttribute("aria-expanded", "true")
  expect(screen.getByText("Job aborted after 5 unsuccessful attempts.")).toBeInTheDocument()
  expect(screen.getByText("CUPS-Auftrag Nr. 42")).toBeInTheDocument()
  expect(screen.getByText("aborted")).toBeInTheDocument()
  expect(screen.getByText("aborted-by-system, media-empty-error")).toBeInTheDocument()

  await user.click(details)

  expect(screen.queryByText("Job aborted after 5 unsuccessful attempts.")).not.toBeInTheDocument()
})

test("Details are for Fehler only", async () => {
  let answer = jobStatus()
  mockApi({ "GET /api/jobs/j1": () => answer })
  renderStatusScreen()

  const states = [
    { word: "Wartet", status: jobStatus({ reason: "Der Drucker ist in CUPS angehalten." }) },
    { word: "Wird gedruckt", status: jobStatus({ state: "printing", reason: "Kein Papier im Drucker." }) },
    { word: "Fertig", status: jobStatus({ state: "done", endedAt: sentAt + 4_000 }) },
  ]
  for (const { word, status } of states) {
    answer = status
    await vi.advanceTimersByTimeAsync(2_000)
    expect(screen.getByRole("heading")).toHaveTextContent(word)
    expect(screen.queryByRole("button", { name: "Details" }), word).not.toBeInTheDocument()
  }
})
