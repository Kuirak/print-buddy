import type { CupsJobDetails } from "../../shared/api.ts"
import { JobState, Op, Status, Tag, attr, decodeIpp, encodeIpp, v, values, type IppAttribute, type IppMessage } from "./ipp-codec.ts"

/** Every request to CUPS is made as this user, so Print Buddy owns its jobs and may cancel them. */
const user = "print-buddy"

/** The IPP names of the `job-state` numbers. */
const jobStateKeywords: Record<number, string> = {
  [JobState.pending]: "pending",
  [JobState.held]: "pending-held",
  [JobState.processing]: "processing",
  [JobState.stopped]: "processing-stopped",
  [JobState.canceled]: "canceled",
  [JobState.aborted]: "aborted",
  [JobState.completed]: "completed",
}

/** Reads the job group of a Print-Job or Get-Job-Attributes answer. */
function jobDetails(reply: IppMessage): CupsJobDetails {
  const jobState = values(reply, Tag.job, "job-state")[0]
  if (typeof jobState !== "number") throw new Error("ipp: answer without job-state")
  return {
    jobState: jobStateKeywords[jobState] ?? String(jobState),
    jobStateReasons: values(reply, Tag.job, "job-state-reasons").map(String),
    // CUPS leaves the message out until the job was processed once
    printerMessage: String(values(reply, Tag.job, "job-printer-state-message")[0] ?? ""),
  }
}

/** CUPS answered and said no: a bare HTTP status (how it refuses a Cancel-Job from a non-owner) or an IPP error status. */
export class IppRefusal extends Error {}

export type PrinterClient = ReturnType<typeof createPrinterClient>

/**
 * The Printer client: IPP against `printer_uri`, hand-written because `@sealsystems/ipp`
 * drops the PPD keywords (see the README's development notes).
 */
export function createPrinterClient(printerUri: string) {
  // ipp://host:port/printers/Queue is HTTP POST to http://host:port/printers/Queue
  const httpUrl = printerUri.replace(/^ipp:/, "http:").replace(/^ipps:/, "https:")
  let nextRequestId = 1

  async function call(code: number, operationAttributes: IppAttribute[], data: Uint8Array = new Uint8Array(0)): Promise<IppMessage> {
    const body = encodeIpp({
      version: [1, 1],
      code,
      requestId: nextRequestId++,
      data,
      groups: [{
        tag: Tag.operation,
        attributes: [
          // CUPS requires this order: charset, language, target, then the rest
          attr("attributes-charset", v.charset("utf-8")),
          attr("attributes-natural-language", v.lang("en")),
          attr("printer-uri", v.uri(printerUri)),
          attr("requesting-user-name", v.name(user)),
          ...operationAttributes,
        ],
      }],
    })
    const res = await fetch(httpUrl, {
      method: "POST",
      headers: { "content-type": "application/ipp" },
      body,
      signal: AbortSignal.timeout(30_000),
    })
    if (res.status !== 200) throw new IppRefusal(`ipp: http ${res.status}`)
    const reply = decodeIpp(new Uint8Array(await res.arrayBuffer()))
    if (reply.code !== Status.ok) {
      throw new IppRefusal(`ipp: status 0x${reply.code.toString(16).padStart(4, "0")} ${String(values(reply, Tag.operation, "status-message")[0] ?? "")}`)
    }
    return reply
  }

  return {
    /** Sends the PDF as one job and returns the job number CUPS assigned, with the job's first state. */
    async printJob(pdf: Uint8Array): Promise<{ cupsJobId: number; details: CupsJobDetails }> {
      const reply = await call(Op.printJob, [
        attr("job-name", v.name("Print Buddy")),
        attr("document-format", v.mime("application/pdf")),
      ], pdf)
      const cupsJobId = values(reply, Tag.job, "job-id")[0]
      if (typeof cupsJobId !== "number") throw new Error("ipp: Print-Job answer without job-id")
      return { cupsJobId, details: jobDetails(reply) }
    },

    /** What CUPS knows about the job right now. */
    async getJobAttributes(cupsJobId: number): Promise<CupsJobDetails> {
      return jobDetails(await call(Op.getJobAttributes, [
        attr("job-id", v.int(cupsJobId)),
        attr("requested-attributes", ...["job-id", "job-state", "job-state-reasons", "job-printer-state-message"].map(v.keyword)),
      ]))
    },

    /** Asks CUPS to cancel the job. False when CUPS refuses, which it does unless the job is ours and still running. */
    async cancelJob(cupsJobId: number): Promise<boolean> {
      try {
        await call(Op.cancelJob, [attr("job-id", v.int(cupsJobId))])
        return true
      } catch (err) {
        if (err instanceof IppRefusal) return false
        throw err
      }
    },
  }
}
