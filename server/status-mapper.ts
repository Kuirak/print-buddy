import type { CupsJobDetails, ScreenState } from "../shared/api.ts"

/**
 * What the CUPS socket backend reports while it can't hand the job to the Printer. CUPS keeps such a
 * job in `processing` and retries for days, so the message is the only sign that nothing prints yet.
 */
const notConnectedMessages = [
  "Connecting to printer.",
  "The printer is not responding.",
  "The printer may not exist or is unavailable at this time.",
  "The printer is unreachable at this time.",
  "The printer is in use.",
]

/** Status mapper: turns what CUPS reports about a job into a screen state and a short German reason. */
export function mapStatus(cups: CupsJobDetails): { state: ScreenState; reason: string | null } {
  if (cups.jobState === "completed") return { state: "done", reason: null }
  if (cups.jobState === "aborted") return { state: "error", reason: "Beim Drucken ist ein Fehler aufgetreten." }
  if (cups.jobState === "canceled") return { state: "error", reason: "Der Auftrag wurde von jemand anderem abgebrochen." }
  if (cups.jobState === "processing" && !notConnectedMessages.includes(cups.printerMessage)) return { state: "printing", reason: null }
  return { state: "waiting", reason: null }
}
