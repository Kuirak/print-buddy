// What the person was doing when the login ran out, kept on the phone across the page load of the
// login. The files of the job are the phone's copy (phone-files.ts); this is the rest of it.
// It is written when "Anmeldung abgelaufen" appears in the middle of a job, and read once, when the
// app opens the next time.
import type { JobSubmitted } from "../../shared/api.ts"
import { parsePrintOptions, type PrintOptions } from "../../shared/print-options.ts"

export type InterruptedJob =
  /** Before the Print Job was sent. `options`: what the person last tapped Drucken with, if they had got that far. */
  | { options?: PrintOptions; job?: undefined }
  /** On the status screen of the Print Job `job`, which was sent with `options`. */
  | { options: PrintOptions; job: JobSubmitted }

const storageKey = "print-buddy.interrupted-job"

function parseJob(value: unknown): JobSubmitted | undefined {
  if (typeof value !== "object" || value === null || !("jobId" in value) || !("cupsJobId" in value)) return undefined
  const { jobId, cupsJobId } = value
  return typeof jobId === "string" && typeof cupsJobId === "number" ? { jobId, cupsJobId } : undefined
}

export const interruptedJob = {
  keep(job: InterruptedJob): void {
    localStorage.setItem(storageKey, JSON.stringify(job))
  },

  /**
   * Hands out what was kept and forgets it, so that it can't outlive the one page load it was kept for.
   * Nothing when the login did not run out in the middle of a job.
   */
  take(): InterruptedJob | undefined {
    const kept = localStorage.getItem(storageKey)
    if (kept === null) return undefined
    localStorage.removeItem(storageKey)
    try {
      const raw: unknown = JSON.parse(kept)
      if (typeof raw !== "object" || raw === null) return undefined
      // Print Options this version doesn't understand are left out: the options screen then starts anew
      const options = "options" in raw ? parsePrintOptions(raw.options) : undefined
      const job = "job" in raw ? parseJob(raw.job) : undefined
      return options && job ? { options, job } : { options }
    } catch {
      return undefined
    }
  },
}
