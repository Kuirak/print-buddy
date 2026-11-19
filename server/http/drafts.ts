import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { readFile } from "node:fs/promises"
import type { ApiError, DraftCreated, FileFacts, JobSubmitted, Refusal, RefusalType, SubmitFailure } from "../../shared/api.ts"
import { parsePrintOptions } from "../../shared/print-options.ts"
import type { Intake } from "../intake.ts"
import type { JobStore } from "../job-store.ts"
import { IppRefusal, type PrinterClient } from "../printer/client.ts"

const refusalStatus = {
  "too-large": 413,
  "unsupported-type": 415,
  "too-many-photos": 409,
  "one-pdf-only": 409,
  "mixed-types": 409,
} as const satisfies Record<RefusalType, number>

/** Room for the multipart boundary and part headers around the one file of an upload. */
const multipartOverhead = 64 * 1024

export function draftRoutes(deps: { intake: Intake; jobs: JobStore; printer: PrinterClient }) {
  const app = new Hono()
  const notFound: ApiError = { error: "not-found" }
  const refuse = (refusal: Refusal) => Response.json(refusal, { status: refusalStatus[refusal.refusal] })
  // counts the bytes as they arrive and stops reading at the limit, so an oversized file is never held in memory
  const withinUploadLimit = bodyLimit({
    maxSize: deps.intake.uploadLimitBytes + multipartOverhead,
    onError: () => refuse(deps.intake.tooLarge),
  })

  app.post("/api/drafts", async c => {
    return c.json<DraftCreated>({ draftId: await deps.intake.createDraft() }, 201)
  })

  app.post("/api/drafts/:draftId/files", withinUploadLimit, async c => {
    const file = (await c.req.parseBody())["file"]
    if (!(file instanceof File)) return c.json<ApiError>({ error: "no-file" }, 400)
    const result = await deps.intake.addFile(c.req.param("draftId"), new Uint8Array(await file.arrayBuffer()))
    if (result.outcome === "unknown-draft") return c.json(notFound, 404)
    if (result.outcome === "refused") return refuse(result.refusal)
    return c.json<FileFacts>(result.facts, 201)
  })

  app.post("/api/drafts/:draftId/submit", async c => {
    const files = deps.intake.files(c.req.param("draftId"))
    if (!files) return c.json(notFound, 404)
    const file = files[0]
    if (!file) return c.json<ApiError>({ error: "empty-draft" }, 400)
    const options = parsePrintOptions(await c.req.json().catch(() => undefined))
    if (!options) return c.json<ApiError>({ error: "invalid-options" }, 400)
    // until the renderer builds the sheets: one sheet per page of the PDF, or per photo, for every copy
    const sheets = (file.facts.kind === "pdf" ? file.facts.pageCount : files.length) * options.copies
    // a failed submit leaves the draft as it was, so the same submit can be tried again
    const failed = (error: SubmitFailure["error"], status: 500 | 502, err: unknown) => {
      console.warn(`Submit failed (${error}):`, err instanceof Error ? err.message : err)
      return c.json<SubmitFailure>({ error }, status)
    }
    let pdf: Uint8Array
    try {
      pdf = await readFile(file.path)
    } catch (err) {
      return failed("render-failed", 500, err)
    }
    const sent = await deps.printer.printJob(pdf, options).catch((err: unknown) => (
      failed(err instanceof IppRefusal ? "cups-rejected" : "cups-unreachable", 502, err)
    ))
    if (sent instanceof Response) return sent
    const { cupsJobId, details } = sent
    const job = deps.jobs.add({ cupsJobId, sheets, details })
    return c.json<JobSubmitted>({ jobId: job.id, cupsJobId }, 201)
  })

  return app
}
