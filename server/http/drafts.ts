import { PDFDocument } from "@cantoo/pdf-lib"
import { Hono } from "hono"
import { readFile } from "node:fs/promises"
import type { ApiError, DraftCreated, FileFacts, JobSubmitted } from "../../shared/api.ts"
import type { Intake } from "../intake.ts"
import type { JobStore } from "../job-store.ts"
import type { PrinterClient } from "../printer/client.ts"

export function draftRoutes(deps: { intake: Intake; jobs: JobStore; printer: PrinterClient }) {
  const app = new Hono()
  const notFound: ApiError = { error: "not-found" }

  app.post("/api/drafts", async c => {
    return c.json<DraftCreated>({ draftId: await deps.intake.createDraft() }, 201)
  })

  app.post("/api/drafts/:draftId/files", async c => {
    const file = (await c.req.parseBody())["file"]
    if (!(file instanceof File)) return c.json<ApiError>({ error: "no-file" }, 400)
    const facts = await deps.intake.addFile(c.req.param("draftId"), new Uint8Array(await file.arrayBuffer()))
    if (!facts) return c.json(notFound, 404)
    return c.json<FileFacts>(facts, 201)
  })

  app.post("/api/drafts/:draftId/submit", async c => {
    const files = deps.intake.files(c.req.param("draftId"))
    if (!files) return c.json(notFound, 404)
    const file = files[0]
    if (!file) return c.json<ApiError>({ error: "empty-draft" }, 400)
    const pdf = await readFile(file.path)
    // until the renderer builds the sheets, the upload goes out as it is: one sheet per page
    const sheets = (await PDFDocument.load(pdf)).getPageCount()
    const { cupsJobId, details } = await deps.printer.printJob(pdf)
    const job = deps.jobs.add({ cupsJobId, sheets, details })
    return c.json<JobSubmitted>({ jobId: job.id, cupsJobId }, 201)
  })

  return app
}
