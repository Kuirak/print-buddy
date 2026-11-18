// The HTTP API's JSON shapes, shared by the server (`server/http/`) and the app (`ui/src/api.ts`).
// Keep this file free of DOM and Node imports.

import type { Paper, PrintOptions } from "./print-options.ts"

/** POST /api/drafts/:draftId/submit takes the Print Options as its JSON body. */
export type SubmitRequest = PrintOptions

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

/** Widths of the strips along the sheet's edges the Printer can't print on, in points (1/72 inch). */
export type Margins = { top: number; right: number; bottom: number; left: number }

/** The printable margins of each paper, for the sheet in portrait. */
export type PaperMargins = Record<Paper, Margins>

/** `unknown`: CUPS didn't answer. `reasons` are the raw `printer-state-reasons` keywords. */
export type PrinterStatus = {
  state: "idle" | "processing" | "stopped" | "unknown"
  reasons: string[]
  message: string
}

/** GET /api/printer */
export type PrinterInfo = PrinterStatus & { margins: PaperMargins }
