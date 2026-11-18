// The HTTP API's JSON shapes, shared by the server (`server/http/`) and the app (`ui/src/api.ts`).
// Keep this file free of DOM and Node imports.

/** POST /api/drafts */
export type DraftCreated = { draftId: string }

/** POST /api/drafts/:draftId/files (multipart, field `file`, one file per request) */
export type FileFacts = { kind: "pdf" }

/** POST /api/drafts/:draftId/submit */
export type JobSubmitted = {
  /** Print Buddy's id for the Print Job. */
  jobId: string
  /** The job number CUPS assigned. */
  cupsJobId: number
}

/** Body of every 4xx answer that is not a typed refusal. */
export type ApiError = { error: string }

/** What the status screen shows: Wartet, Wird gedruckt, Fertig, Abgebrochen or Fehler. */
export type ScreenState = "waiting" | "printing" | "done" | "cancelled" | "error"

/** GET /api/jobs/:jobId, and the answer to POST /api/jobs/:jobId/cancel */
export type JobStatus = {
  jobId: string
  state: ScreenState
  /** A short German sentence, or null when there is nothing to explain. */
  reason: string | null
  /** What CUPS said, unchanged. */
  details: CupsJobDetails
  /** The job number CUPS assigned. */
  cupsJobId: number
  /** When CUPS accepted the job, in ms since the epoch. */
  sentAt: number
  /** When Print Buddy first saw that the job had ended, in ms since the epoch; null while it runs. */
  endedAt: number | null
  sheets: number
}

export type CupsJobDetails = {
  /** The IPP `job-state` keyword, for example `pending` or `processing`. */
  jobState: string
  /** IPP `job-state-reasons`. */
  jobStateReasons: string[]
  /** IPP `job-printer-state-message`: the last line the CUPS backend reported. */
  printerMessage: string
}
