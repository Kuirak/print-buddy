// Seam 3 helper: what the server answers when the status screen reads a Print Job.
import type { JobStatus } from "../../../shared/api.ts"

/** When job `j1` was sent. */
export const sentAt = Date.UTC(2026, 10, 19, 8, 30, 0)

/** Job `j1`, CUPS job 42, waiting since `sentAt`, changed by `changes`. */
export const jobStatus = (changes: Partial<JobStatus> = {}): JobStatus => ({
  jobId: "j1",
  state: "waiting",
  reason: null,
  details: { jobState: "pending", jobStateReasons: ["none"], printerStateReasons: [], printerMessage: "" },
  cupsJobId: 42,
  sentAt,
  endedAt: null,
  sheets: 1,
  file: { kind: "pdf", bytes: 48_213, count: 1 },
  options: {
    copies: 1, color: "mono", paper: "A4", quality: "normal",
    printSize: { kind: "fit" }, position: "center", pagesPerSheet: 1, rotation: 0, selection: [1],
  },
  ...changes,
})
