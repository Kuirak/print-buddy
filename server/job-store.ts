import { randomUUID } from "node:crypto"
import { mkdir, rename, writeFile } from "node:fs/promises"
import { extname, join } from "node:path"
import type { CupsJobDetails } from "../shared/api.ts"
import type { PrintOptions } from "../shared/print-options.ts"
import type { Now } from "./clock.ts"

/** What Print Buddy remembers about a Print Job. Never names of people, emails or file names. */
export interface PrintJob {
  id: string
  cupsJobId: number
  /** When CUPS accepted the job, in ms since the epoch. */
  sentAt: number
  /** When Print Buddy first saw that the job had ended, in ms since the epoch; null while it runs. */
  endedAt: number | null
  /** Sheets of paper the job asks for. */
  sheets: number
  options: PrintOptions
  /** What CUPS last said about the job. */
  details: CupsJobDetails
  /** Print Buddy cancelled the job itself. CUPS can't tell: it marks every cancelled job the same way. */
  cancelled: boolean
}

export interface NewPrintJob extends Pick<PrintJob, "cupsJobId" | "sheets" | "options" | "details"> {
  /** The PDF as it was sent to CUPS. */
  pdf: Uint8Array
  /** Paths of the uploaded files, in upload order. They are moved into the job folder. */
  uploads: readonly string[]
}

export type JobStore = ReturnType<typeof createJobStore>

/**
 * Job store: one folder per Print Job, `<date>_<job-id>` under the jobs directory, with the uploads
 * (`upload-<n>`), the PDF that was sent to CUPS (`print.pdf`) and the record (`job.json`).
 * The date is the UTC day the job was sent.
 */
export function createJobStore(deps: { jobsDir: string; now: Now }) {
  const jobs = new Map<string, PrintJob>()
  const folderOf = (job: PrintJob) => join(deps.jobsDir, `${new Date(job.sentAt).toISOString().slice(0, 10)}_${job.id}`)

  /** job.json is the record with its times as ISO 8601 text, so a person can read them. */
  async function writeRecord(job: PrintJob): Promise<void> {
    const record = {
      ...job,
      sentAt: new Date(job.sentAt).toISOString(),
      endedAt: job.endedAt === null ? null : new Date(job.endedAt).toISOString(),
    }
    await writeFile(join(folderOf(job), "job.json"), JSON.stringify(record, null, 2) + "\n")
  }

  return {
    /** Records a job CUPS has accepted and fills its folder. */
    async add(job: NewPrintJob): Promise<PrintJob> {
      const record: PrintJob = {
        id: randomUUID(),
        cupsJobId: job.cupsJobId,
        sentAt: deps.now(),
        endedAt: null,
        sheets: job.sheets,
        options: job.options,
        details: job.details,
        cancelled: false,
      }
      const folder = folderOf(record)
      await mkdir(folder, { recursive: true })
      await writeFile(join(folder, "print.pdf"), job.pdf)
      for (const [i, path] of job.uploads.entries()) await rename(path, join(folder, `upload-${i + 1}${extname(path)}`))
      await writeRecord(record)
      jobs.set(record.id, record)
      return record
    },
    get: (id: string): PrintJob | undefined => jobs.get(id),
    /** Records what was learned about a job since it was sent. */
    update(job: PrintJob, changes: Partial<Pick<PrintJob, "details" | "endedAt" | "cancelled">>): PrintJob {
      const record: PrintJob = { ...job, ...changes }
      jobs.set(record.id, record)
      return record
    },
  }
}
