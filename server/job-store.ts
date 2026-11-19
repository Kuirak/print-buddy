import { randomUUID } from "node:crypto"
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { extname, join } from "node:path"
import { isDeepStrictEqual } from "node:util"
import type { CupsJobDetails, JobFile } from "../shared/api.ts"
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
  file: JobFile
  options: PrintOptions
  /** What CUPS last said about the job. */
  details: CupsJobDetails
  /** Print Buddy cancelled the job itself. CUPS can't tell: it marks every cancelled job the same way. */
  cancelled: boolean
}

interface NewPrintJob extends Pick<PrintJob, "cupsJobId" | "sheets" | "file" | "options" | "details"> {
  /** The PDF as it was sent to CUPS. */
  pdf: Uint8Array
  /** Paths of the uploaded files, in upload order. They are moved into the job folder. */
  uploads: readonly string[]
}

export type JobStore = Awaited<ReturnType<typeof openJobStore>>

/** A job folder's name: the UTC day the job was sent, then the job id. */
const jobFolderName = /^(\d{4}-\d{2}-\d{2})_([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/

const day = 24 * 60 * 60 * 1000

/** How long a job folder is kept after the job was sent. */
const keepFor = 7 * day

/**
 * Job store: one folder per Print Job, `<date>_<job-id>` under the jobs directory, with the uploads
 * (`upload-<n>`), the PDF that was sent to CUPS (`print.pdf`) and the record (`job.json`).
 * Opening it reads the records of the job folders that are already there.
 */
export async function openJobStore(deps: { jobsDir: string; now: Now }) {
  const jobs = new Map<string, PrintJob>()
  const folderOf = (job: PrintJob) => join(deps.jobsDir, `${new Date(job.sentAt).toISOString().slice(0, 10)}_${job.id}`)

  await mkdir(deps.jobsDir, { recursive: true })
  for (const name of await readdir(deps.jobsDir)) {
    if (!jobFolderName.test(name)) continue
    try {
      // written by writeRecord below, so it is read back without further checks
      const record = JSON.parse(await readFile(join(deps.jobsDir, name, "job.json"), "utf8"))
      jobs.set(record.id, {
        ...record,
        sentAt: Date.parse(record.sentAt),
        endedAt: record.endedAt === null ? null : Date.parse(record.endedAt),
      })
    } catch (err) {
      console.warn(`Print Job folder ${name} has no readable job.json:`, err instanceof Error ? err.message : err)
    }
  }

  // one write at a time, in the order of the changes: two writes of one job.json at once could leave a mix of both
  let lastWrite: Promise<void> = Promise.resolve()

  /**
   * job.json is the record with its times as ISO 8601 text, so a person can read them.
   * A write that fails is logged and not thrown: the job's status is read from memory, and stays readable.
   */
  function writeRecord(job: PrintJob): Promise<void> {
    const record = {
      ...job,
      sentAt: new Date(job.sentAt).toISOString(),
      endedAt: job.endedAt === null ? null : new Date(job.endedAt).toISOString(),
    }
    lastWrite = lastWrite
      .then(() => writeFile(join(folderOf(job), "job.json"), JSON.stringify(record, null, 2) + "\n"))
      .catch(err => console.error(`job.json of Print Job ${job.id} could not be written:`, err instanceof Error ? err.message : err))
    return lastWrite
  }

  return {
    /**
     * Records a job CUPS has accepted and fills its folder. CUPS prints the job whatever happens here, so it
     * is known from now on even when its folder can't be filled: that is logged and not thrown.
     */
    async add(job: NewPrintJob): Promise<PrintJob> {
      const record: PrintJob = {
        id: randomUUID(),
        cupsJobId: job.cupsJobId,
        sentAt: deps.now(),
        endedAt: null,
        sheets: job.sheets,
        file: job.file,
        options: job.options,
        details: job.details,
        cancelled: false,
      }
      jobs.set(record.id, record)
      const folder = folderOf(record)
      try {
        await mkdir(folder, { recursive: true })
        await writeFile(join(folder, "print.pdf"), job.pdf)
        for (const [i, path] of job.uploads.entries()) await rename(path, join(folder, `upload-${i + 1}${extname(path)}`))
      } catch (err) {
        console.error(`The folder of Print Job ${record.id} (CUPS job ${record.cupsJobId}) is incomplete:`, err instanceof Error ? err.message : err)
      }
      await writeRecord(record)
      return record
    },
    get: (id: string): PrintJob | undefined => jobs.get(id),
    /**
     * Records what was learned about a job since it was sent, on top of what is recorded about it now: `job` may
     * be an older copy, and what it says is not written back. job.json is written only when the changes change
     * something: the status screen asks every 2 s. A job that was deleted meanwhile stays deleted.
     */
    async update(job: PrintJob, changes: Partial<Pick<PrintJob, "details" | "endedAt" | "cancelled">>): Promise<PrintJob> {
      const known = jobs.get(job.id)
      const record: PrintJob = { ...(known ?? job), ...changes }
      if (!known || isDeepStrictEqual(record, known)) return record
      jobs.set(record.id, record)
      await writeRecord(record)
      return record
    },
    /** Deletes the job folders that are older than 7 days. Only folders named like a job folder are looked at. */
    async cleanup(): Promise<void> {
      for (const name of await readdir(deps.jobsDir)) {
        const [, date, id] = jobFolderName.exec(name) ?? []
        if (date === undefined || id === undefined) continue
        // a folder without a readable record can be from any time of the day in its name: it counts from that day's end
        const since = jobs.get(id)?.sentAt ?? Date.parse(date) + day
        // a name with a date that is none (2026-99-99) gives NaN here, and the folder stays
        if (!(deps.now() - since > keepFor)) continue
        jobs.delete(id)
        await rm(join(deps.jobsDir, name), { recursive: true, force: true })
      }
    },
  }
}
