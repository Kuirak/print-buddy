import { Hono, type Context } from "hono"
import { bodyLimit } from "hono/body-limit"
import type { ApiError, DraftCreated, FileFacts, JobFile, JobSubmitted, Refusal, RefusalType, SubmitFailure, SubmitProgress } from "../../shared/api.ts"
import { parsePrintOptions, type PrintOptions } from "../../shared/print-options.ts"
import type { DraftFile, Intake } from "../intake.ts"
import type { JobStore } from "../job-store.ts"
import { IppRefusal, type PrinterClient } from "../printer/client.ts"
import { render, type DellPrinting, type RenderResult } from "../renderer.ts"

const refusalStatus = {
  "too-large": 413,
  "unsupported-type": 415,
  "too-many-photos": 409,
  "one-pdf-only": 409,
  "mixed-types": 409,
} as const satisfies Record<RefusalType, number>

/** Room for the multipart boundary and part headers around the one file of an upload. */
const multipartOverhead = 64 * 1024

/** `dell`: Dell's engine from the share folder, when it is there; colour Print Jobs then go out as HBPL. */
export function draftRoutes(deps: { intake: Intake; jobs: JobStore; printer: PrinterClient; dell?: DellPrinting }) {
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

  /** A submit that runs now: how far it has got, and what stops it while it prepares. */
  type RunningSubmit = { progress: SubmitProgress; stop: AbortController }
  const running = new Map<string, RunningSubmit>()

  app.get("/api/drafts/:draftId/progress", c => {
    const submit = running.get(c.req.param("draftId"))
    return submit ? c.json<SubmitProgress>(submit.progress) : c.json(notFound, 404)
  })

  // once CUPS is getting the job, the submit ends with the Print Job or a failure, and the job can be cancelled instead
  app.post("/api/drafts/:draftId/stop", c => {
    const submit = running.get(c.req.param("draftId"))
    if (!submit) return c.json(notFound, 404)
    if (submit.progress.phase === "sending") return c.json<ApiError>({ error: "not-stoppable" }, 409)
    submit.stop.abort()
    return c.body(null, 204)
  })

  app.post("/api/drafts/:draftId/submit", async c => {
    const draftId = c.req.param("draftId")
    const files = deps.intake.files(draftId)
    if (!files) return c.json(notFound, 404)
    if (files.length === 0) return c.json<ApiError>({ error: "empty-draft" }, 400)
    const options = parsePrintOptions(await c.req.json().catch(() => undefined))
    if (!options) return c.json<ApiError>({ error: "invalid-options" }, 400)
    // a second submit of the same draft would print it twice
    if (running.has(draftId)) return c.json<ApiError>({ error: "already-submitting" }, 409)
    const submit: RunningSubmit = { progress: { phase: "preparing", sheetsDone: 0, sheets: 0 }, stop: new AbortController() }
    running.set(draftId, submit)
    try {
      return await send(c, draftId, files, options, submit)
    } finally {
      running.delete(draftId)
    }
  })

  /** Renders the draft and hands it to CUPS. A failed or stopped submit leaves the draft as it was, so it can be sent again. */
  async function send(
    c: Context, draftId: string, files: readonly DraftFile[], options: PrintOptions, submit: RunningSubmit,
  ): Promise<Response> {
    const stopped = () => c.json<ApiError>({ error: "stopped" }, 409)
    const failed = (error: SubmitFailure["error"], status: 500 | 502, err: unknown) => {
      console.warn(`Submit failed (${error}):`, err instanceof Error ? err.message : err)
      return c.json<SubmitFailure>({ error }, status)
    }
    let rendered: RenderResult
    try {
      rendered = await render(files, options, deps.printer.margins()[options.paper], deps.dell, {
        onProgress: (sheetsDone, sheets) => { submit.progress = { phase: "preparing", sheetsDone, sheets } },
        signal: submit.stop.signal,
      })
    } catch (err) {
      return submit.stop.signal.aborted ? stopped() : failed("render-failed", 500, err)
    }
    if (submit.stop.signal.aborted) return stopped()
    if (rendered.outcome === "invalid-options") return c.json<ApiError>({ error: "invalid-options" }, 400)
    submit.progress = { phase: "sending" }
    // the bytes CUPS gets are the bytes the job folder keeps
    const { document } = rendered
    const sent = await deps.printer.printJob(document, options).catch((err: unknown) => (
      failed(err instanceof IppRefusal ? "cups-rejected" : "cups-unreachable", 502, err)
    ))
    if (sent instanceof Response) return sent
    const { cupsJobId, details } = sent
    const uploads = files.map(file => file.path)
    const facts = files[0]!.facts
    const file: JobFile = {
      kind: facts.kind,
      bytes: files.reduce((sum, upload) => sum + upload.bytes, 0),
      count: facts.kind === "pdf" ? facts.pageCount : files.length,
    }
    // CUPS has the job, so from here on the answer is the Print Job: after a 5xx the app offers "Erneut versuchen", and the job would print twice
    const job = await deps.jobs.add({ cupsJobId, sheets: rendered.sheets, file, options, details, document, uploads })
    // the uploads are in the job folder now
    await deps.intake.discard(draftId).catch((err: unknown) => {
      console.error(`Draft ${draftId} could not be deleted:`, err instanceof Error ? err.message : err)
    })
    return c.json<JobSubmitted>({ jobId: job.id, cupsJobId }, 201)
  }

  return app
}
