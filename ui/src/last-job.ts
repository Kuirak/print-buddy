// The last Print Job sent from this phone, for the line on Start. Only its two numbers are kept, in
// localStorage; its state is read from the server each time. Nothing about the file is stored.
import type { JobSubmitted } from "../../shared/api.ts"

const storageKey = "print-buddy.last-job"

export const lastJob = {
  /** Replaces the job the phone remembers. */
  remember(job: JobSubmitted) {
    localStorage.setItem(storageKey, JSON.stringify({ jobId: job.jobId, cupsJobId: job.cupsJobId }))
  },

  read(): JobSubmitted | undefined {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null")
      if (typeof stored !== "object" || stored === null) return undefined
      const { jobId, cupsJobId } = stored as Record<string, unknown>
      return typeof jobId === "string" && typeof cupsJobId === "number" ? { jobId, cupsJobId } : undefined
    } catch {
      return undefined
    }
  },

  /** The server no longer has the job (job folders go after 7 days). */
  forget() {
    localStorage.removeItem(storageKey)
  },
}
