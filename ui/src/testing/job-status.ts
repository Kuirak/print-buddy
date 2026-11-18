// Seam 3 helper: what the server answers when the status screen reads a Print Job.
import type { JobStatus } from "../../../shared/api.ts"

/** When job `j1` was sent. */
export const sentAt = Date.UTC(2026, 10, 19, 8, 30, 0)

/** Job `j1`, CUPS job 42, waiting since `sentAt`, changed by `changes`. */
export const jobStatus = (changes: Partial<JobStatus> = {}): JobStatus => ({
  jobId: "j1",
  state: "waiting",
  reason: null,
  details: { jobState: "pending", jobStateReasons: ["none"], printerMessage: "" },
  cupsJobId: 42,
  sentAt,
  endedAt: null,
  sheets: 1,
  ...changes,
})
