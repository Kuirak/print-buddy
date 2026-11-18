import { Hono } from "hono"
import type { ApiError, JobStatus } from "../../shared/api.ts"
import type { Now } from "../clock.ts"
import type { JobStore, PrintJob } from "../job-store.ts"
import type { PrinterClient } from "../printer/client.ts"
import { mapStatus } from "../status-mapper.ts"

export function jobRoutes(deps: { jobs: JobStore; printer: PrinterClient; now: Now }) {
  const app = new Hono()
  const notFound: ApiError = { error: "not-found" }

  /** Asks CUPS about a job that is still running and records the answer. An ended job no longer changes. */
  async function refresh(job: PrintJob): Promise<JobStatus> {
    if (job.endedAt === null) {
      const details = await deps.printer.getJobAttributes(job.cupsJobId)
      const ended = mapStatus(details).state === "done"
      job = deps.jobs.update(job, { details, endedAt: ended ? deps.now() : null })
    }
    return {
      jobId: job.id,
      ...mapStatus(job.details),
      details: job.details,
      cupsJobId: job.cupsJobId,
      sentAt: job.sentAt,
      endedAt: job.endedAt,
      sheets: job.sheets,
    }
  }

  app.get("/api/jobs/:jobId", async c => {
    const job = deps.jobs.get(c.req.param("jobId"))
    if (!job) return c.json(notFound, 404)
    return c.json<JobStatus>(await refresh(job))
  })

  return app
}
