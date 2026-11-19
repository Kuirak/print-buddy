// What the person was doing when the login ran out, kept on the phone across the page load of the
// login. The files of the job are the phone's copy (phone-files.ts); this is the rest of it.
// It is written when "Anmeldung abgelaufen" appears in the middle of a job, and read once, when the
// app opens the next time.
import { parsePrintOptions, type PrintOptions } from "../../shared/print-options.ts"

export type InterruptedJob = {
  /** The Print Options the person last tapped Drucken with. Absent when they had not got that far. */
  options?: PrintOptions
}

const storageKey = "print-buddy.interrupted-job"

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
      return { options: "options" in raw ? parsePrintOptions(raw.options) : undefined }
    } catch {
      return undefined
    }
  },
}
