import { Hono } from "hono"
import type { ApiError, CupsJobDetails, JobStatus } from "../../shared/api.ts"
import type { Now } from "../clock.ts"
import type { JobStore, PrintJob } from "../job-store.ts"
import type { PrinterClient } from "../printer/client.ts"
import { mapStatus } from "../status-mapper.ts"

export function jobRoutes(deps: { jobs: JobStore; printer: PrinterClient; now: Now }) {
  const app = new Hono()
  const notFound: ApiError = { error: "not-found" }

  const status = (job: PrintJob): JobStatus => ({
    jobId: job.id,
    ...mapStatus(job.details, job.cancelled),
    details: job.details,
    cupsJobId: job.cupsJobId,
    sentAt: job.sentAt,
    endedAt: job.endedAt,
    sheets: job.sheets,
    file: job.file,
    options: job.options,
  })

  /**
   * Asks CUPS about a job that is still running and records the answer. An ended job no longer changes.
   * When CUPS can't answer, or has forgotten the job, the job stays as it was last seen.
   */
  async function refresh(job: PrintJob): Promise<PrintJob> {
    if (job.endedAt !== null) return job
    let details: CupsJobDetails
    try {
      details = await deps.printer.getJobAttributes(job.cupsJobId)
    } catch (err) {
      console.warn(`CUPS did not answer for job ${job.cupsJobId}:`, err instanceof Error ? err.message : err)
      return job
    }
    // while CUPS was asked, a cancel or another status read may have got further: what is recorded now counts
    const current = deps.jobs.get(job.id) ?? job
    if (current.endedAt !== null) return current
    const { state } = mapStatus(details, current.cancelled)
    const ended = state !== "waiting" && state !== "printing"
    return deps.jobs.update(current, { details, endedAt: ended ? deps.now() : null })
  }

  app.get("/api/jobs/:jobId", async c => {
    const job = deps.jobs.get(c.req.param("jobId"))
    if (!job) return c.json(notFound, 404)
    return c.json<JobStatus>(status(await refresh(job)))
  })

  // allowed while the job runs, Wartet or Wird gedruckt; what the Printer already has may still come out
  app.post("/api/jobs/:jobId/cancel", async c => {
    const known = deps.jobs.get(c.req.param("jobId"))
    if (!known) return c.json(notFound, 404)
    const notCancellable = () => c.json<ApiError>({ error: "not-cancellable" }, 409)
    const job = await refresh(known)
    if (job.endedAt !== null) return notCancellable()
    // recorded before CUPS is asked: a status read that finds the job cancelled while the answer is on its way has to know whose cancel it was
    const marked = await deps.jobs.update(job, { cancelled: true })
    let accepted = false
    try {
      accepted = await deps.printer.cancelJob(job.cupsJobId)
    } finally {
      if (!accepted) await deps.jobs.update(job, { cancelled: false })
    }
    return accepted ? c.json<JobStatus>(status(await refresh(marked))) : notCancellable()
  })

  return app
}
