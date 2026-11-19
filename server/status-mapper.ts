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

const notResponding = "Der Drucker antwortet nicht. Ist er eingeschaltet?"
const paused = "Der Drucker ist in CUPS angehalten."
const noPaper = "Kein Papier im Drucker."
const noToner = "Toner ist leer."
const coverOpen = "Eine Klappe am Drucker ist offen."

/** German texts for the reason keywords of `job-state-reasons` and `printer-state-reasons`, without their severity suffix. */
const reasonTexts: Record<string, string> = {
  "offline": notResponding,
  "connecting-to-device": "Verbindung zum Drucker wird aufgebaut.",
  "media-empty": noPaper,
  "media-needed": noPaper,
  "media-jam": "Papierstau im Drucker.",
  // `stopped` is the spec's word; CUPS says `paused` for the queue and `printer-stopped` for the job
  "stopped": paused,
  "stopped-partly": paused,
  "paused": paused,
  "printer-stopped": paused,
  "toner-empty": noToner,
  "marker-supply-empty": noToner,
  "cover-open": coverOpen,
  "door-open": coverOpen,
}

/** Backend messages that say as much as a reason keyword. */
const messageTexts: Record<string, string> = {
  "The printer is not responding.": notResponding,
}

/** The German text for the first reason Print Buddy knows: the job's reasons, then the Printer's, then the backend message. */
function knownReason(cups: CupsJobDetails): string | null {
  for (const keyword of [...cups.jobStateReasons, ...cups.printerStateReasons]) {
    // a printer reason may end in its severity: media-empty-warning, offline-report
    const text = reasonTexts[keyword.replace(/-(report|warning|error)$/, "")]
    if (text) return text
  }
  return messageTexts[cups.printerMessage] ?? null
}

function screenState(cups: CupsJobDetails, cancelledByPrintBuddy: boolean): ScreenState {
  if (cups.jobState === "completed") return "done"
  if (cups.jobState === "aborted") return "error"
  if (cups.jobState === "canceled") return cancelledByPrintBuddy ? "cancelled" : "error"
  if (cups.jobState === "processing" && !notConnectedMessages.includes(cups.printerMessage)) return "printing"
  return "waiting"
}

/**
 * Status mapper: turns what CUPS reports about a job into a screen state and a short German reason.
 * CUPS marks every cancelled job `job-canceled-by-user`, so Print Buddy's own cancel comes as a flag.
 * Fehler always has a reason. A running job has one only when CUPS names a reason Print Buddy knows.
 */
export function mapStatus(cups: CupsJobDetails, cancelledByPrintBuddy: boolean): { state: ScreenState; reason: string | null } {
  const state = screenState(cups, cancelledByPrintBuddy)
  if (state === "done" || state === "cancelled") return { state, reason: null }
  if (state !== "error") return { state, reason: knownReason(cups) }
  if (cups.jobState === "canceled") return { state, reason: "Der Auftrag wurde von jemand anderem abgebrochen." }
  return { state, reason: knownReason(cups) ?? "Beim Drucken ist ein Fehler aufgetreten." }
}
