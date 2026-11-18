// The HTTP API's JSON shapes, shared by the server (`server/http/`) and the app (`ui/src/api.ts`).
// Keep this file free of DOM and Node imports.

import type { Paper, PrintOptions } from "./print-options.ts"

/** POST /api/drafts/:draftId/submit takes the Print Options as its JSON body. */
export type SubmitRequest = PrintOptions

/** POST /api/drafts */
export type DraftCreated = { draftId: string }

/** POST /api/drafts/:draftId/files (multipart, field `file`, one file per request): 201 with the file's facts. */
export type FileFacts = PdfFacts | PhotoFacts

export type PdfFacts = {
  kind: "pdf"
  pageCount: number
  /** Each page's size in points as a reader shows it: the CropBox, with the page's own rotation applied. */
  pages: { width: number; height: number }[]
}

export type PhotoFacts = {
  kind: "photo"
  format: "jpeg" | "png"
  /** Pixel size as stored in the file, before `orientation` is applied. */
  width: number
  height: number
  /** EXIF orientation, 1 to 8. 1 (upright) when the file has none. */
  orientation: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
}

export type RefusalType = "unsupported-type" | "too-large" | "too-many-photos" | "one-pdf-only" | "mixed-types"

/**
 * Body of the answer when a file is refused. Status 413 for `too-large`, 415 for `unsupported-type`,
 * 409 for the three that depend on what the draft already holds. The draft stays as it was.
 */
export type Refusal =
  | { refusal: Exclude<RefusalType, "too-large"> }
  /** `limitMb` is the add-on's `upload_limit_mb`. */
  | { refusal: "too-large"; limitMb: number }

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
  /** IPP `job-printer-state-reasons`: the Printer's reasons while it has the job. Empty until CUPS reports them. */
  printerStateReasons: string[]
  /** IPP `job-printer-state-message`: the last line the CUPS backend reported. */
  printerMessage: string
}

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
