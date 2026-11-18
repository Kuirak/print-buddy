import { Hono } from "hono"
import { readFile } from "node:fs/promises"
import type { ApiError, DraftCreated, FileFacts, JobSubmitted } from "../../shared/api.ts"
import { parsePrintOptions } from "../../shared/print-options.ts"
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
    const options = parsePrintOptions(await c.req.json().catch(() => undefined))
    if (!options) return c.json<ApiError>({ error: "invalid-options" }, 400)
    const { cupsJobId } = await deps.printer.printJob(await readFile(file.path), options)
    const job = deps.jobs.add({ cupsJobId })
    return c.json<JobSubmitted>({ jobId: job.id, cupsJobId }, 201)
  })

  return app
}
