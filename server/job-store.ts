import { randomUUID } from "node:crypto"
import type { CupsJobDetails } from "../shared/api.ts"
import type { Now } from "./clock.ts"

/** What Print Buddy remembers about a Print Job. Never names of people, emails or file names. */
export interface PrintJob {
  id: string
  cupsJobId: number
  /** When CUPS accepted the job, in ms since the epoch. */
  sentAt: number
  /** Sheets of paper the job asks for. */
  sheets: number
  /** What CUPS last said about the job. */
  details: CupsJobDetails
  /** When Print Buddy first saw that the job had ended, in ms since the epoch; null while it runs. */
  endedAt: number | null
}

export type JobStore = ReturnType<typeof createJobStore>

export function createJobStore(deps: { now: Now }) {
  const jobs = new Map<string, PrintJob>()

  return {
    add(job: Pick<PrintJob, "cupsJobId" | "sheets" | "details">): PrintJob {
      const record: PrintJob = { id: randomUUID(), sentAt: deps.now(), endedAt: null, ...job }
      jobs.set(record.id, record)
      return record
    },
    get: (id: string): PrintJob | undefined => jobs.get(id),
    /** Records what was learned about a job since it was sent. */
    update(job: PrintJob, changes: Partial<Pick<PrintJob, "details" | "endedAt">>): PrintJob {
      const record: PrintJob = { ...job, ...changes }
      jobs.set(record.id, record)
      return record
    },
  }
}
