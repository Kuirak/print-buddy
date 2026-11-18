import { randomUUID } from "node:crypto"
import type { Now } from "./clock.ts"

/** What Print Buddy remembers about a Print Job. Never names of people, emails or file names. */
export interface PrintJob {
  id: string
  cupsJobId: number
  /** When CUPS accepted the job, in ms since the epoch. */
  sentAt: number
}

export type JobStore = ReturnType<typeof createJobStore>

export function createJobStore(deps: { now: Now }) {
  const jobs = new Map<string, PrintJob>()

  return {
    add(job: { cupsJobId: number }): PrintJob {
      const record: PrintJob = { id: randomUUID(), cupsJobId: job.cupsJobId, sentAt: deps.now() }
      jobs.set(record.id, record)
      return record
    },
    get: (id: string): PrintJob | undefined => jobs.get(id),
  }
}
