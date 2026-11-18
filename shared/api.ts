// The HTTP API's JSON shapes, shared by the server (`server/http/`) and the app (`ui/src/api.ts`).
// Keep this file free of DOM and Node imports.

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
