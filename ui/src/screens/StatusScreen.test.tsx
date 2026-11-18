import { render, screen } from "@solidjs/testing-library"
import { userEvent } from "@testing-library/user-event"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { JobStatus } from "../../../shared/api.ts"
import { json, mockApi, type ApiCall } from "../testing/mock-api.ts"
import { StatusScreen } from "./StatusScreen.tsx"

const sentAt = Date.UTC(2026, 10, 19, 8, 30, 0)

/** What the server answers for job `j1`: waiting, unless the test says otherwise. */
const jobStatus = (changes: Partial<JobStatus> = {}): JobStatus => ({
  jobId: "j1",
  state: "waiting",
  reason: null,
  details: { jobState: "pending", jobStateReasons: ["none"], printerMessage: "" },
  cupsJobId: 42,
  sentAt,
  endedAt: null,
  sheets: 1,
  ...changes,
})

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

test("Abbrechen is offered only while the Print Job waits", async () => {
  let answer = jobStatus()
  mockApi({ "GET /api/jobs/j1": () => answer })
  renderStatusScreen()

  await vi.advanceTimersByTimeAsync(0)
  expect(screen.getByRole("button", { name: "Abbrechen" })).toBeInTheDocument()

  answer = jobStatus({ state: "printing" })
  await vi.advanceTimersByTimeAsync(2_000)
  expect(screen.getByRole("heading")).toHaveTextContent("Wird gedruckt")
  expect(screen.queryByRole("button", { name: "Abbrechen" })).not.toBeInTheDocument()

  answer = jobStatus({ state: "done", endedAt: sentAt + 4_000 })
  await vi.advanceTimersByTimeAsync(2_000)
  expect(screen.getByRole("heading")).toHaveTextContent("Fertig")
  expect(screen.queryByRole("button", { name: "Abbrechen" })).not.toBeInTheDocument()
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

test("when the cancel comes too late, the screen keeps following the Print Job", async () => {
  let answer = jobStatus()
  mockApi({
    "GET /api/jobs/j1": () => answer,
    "POST /api/jobs/j1/cancel": () => json({ error: "not-cancellable" }, 409),
  })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  renderStatusScreen()
  await vi.advanceTimersByTimeAsync(0)

  answer = jobStatus({ state: "printing" })
  await user.click(screen.getByRole("button", { name: "Abbrechen" }))
  await vi.advanceTimersByTimeAsync(2_000)

  expect(screen.getByRole("heading")).toHaveTextContent("Wird gedruckt")
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
