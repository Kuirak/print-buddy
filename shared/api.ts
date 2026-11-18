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
