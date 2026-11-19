import type { CupsJobDetails, Margins, PaperMargins, PrinterStatus } from "../../shared/api.ts"
import { papers, type Paper, type PrintOptions } from "../../shared/print-options.ts"
import {
  JobState, Op, PrinterState, Status, Tag, attr, decodeIpp, encodeIpp, findAttr, v, values,
  type IppAttribute, type IppCollection, type IppMessage,
} from "./ipp-codec.ts"

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
    // not part of the Print-Job answer
    printerStateReasons: values(reply, Tag.job, "job-printer-state-reasons").map(String),
    // CUPS leaves the message out until the job was processed once
    printerMessage: String(values(reply, Tag.job, "job-printer-state-message")[0] ?? ""),
  }
}

/** CUPS answered and said no: a bare HTTP status (how it refuses a Cancel-Job from a non-owner) or an IPP error status. */
export class IppRefusal extends Error {}

/** The Print Options CUPS acts on. Everything else is already drawn into the PDF. */
type JobOptions = Pick<PrintOptions, "copies" | "color" | "paper" | "quality">

/** Used for every paper CUPS reports no margins for: the A4 ImageableArea of the Printer's PPD, in points. */
const fallbackMargins: Margins = { top: 12, right: 9, bottom: 12, left: 9 }

// `media-col-database` carries no paper names, so a paper is found by its size. Portrait, in 1/100 mm.
// cupsd derives its numbers from PPD points, so they are a few hundredths off (A4 is 20990 × 29704).
const paperSizes: Record<Paper, [width: number, height: number]> = {
  A4: [21000, 29700],
  A5: [14800, 21000],
  EnvDL: [11000, 22000],
  EnvC5: [16200, 22900],
}
const sizeTolerance = 50

const printerStates: Record<number, PrinterStatus["state"]> = {
  [PrinterState.idle]: "idle",
  [PrinterState.processing]: "processing",
  [PrinterState.stopped]: "stopped",
}

/** 1/100 mm to points, with two decimals. */
const toPoints = (hundredthsOfMm: number) => Math.round(hundredthsOfMm * 72 / 2540 * 100) / 100

function marginsOf(database: IppCollection[], paper: Paper): Margins | undefined {
  const [width, height] = paperSizes[paper]
  const int = (collection: IppCollection | undefined, member: string) => {
    const value = collection?.[member]?.[0]?.value
    return typeof value === "number" ? value : NaN
  }
  for (const media of database) {
    const size = media["media-size"]?.[0]?.value as IppCollection | undefined
    if (!(Math.abs(int(size, "x-dimension") - width) <= sizeTolerance && Math.abs(int(size, "y-dimension") - height) <= sizeTolerance)) continue
    const margins = {
      top: toPoints(int(media, "media-top-margin")),
      right: toPoints(int(media, "media-right-margin")),
      bottom: toPoints(int(media, "media-bottom-margin")),
      left: toPoints(int(media, "media-left-margin")),
    }
    if (Object.values(margins).every(Number.isFinite)) return margins
  }
  return undefined
}

export type PrinterClient = ReturnType<typeof createPrinterClient>

/**
 * The Printer client: IPP against `printer_uri`, hand-written because `@sealsystems/ipp`
 * drops the PPD keywords (see the README's development notes).
 */
export function createPrinterClient(printerUri: string) {
  // ipp://host:port/printers/Queue is HTTP POST to http://host:port/printers/Queue
  const httpUrl = printerUri.replace(/^ipp:/, "http:").replace(/^ipps:/, "https:")
  let nextRequestId = 1
  let margins: PaperMargins = { A4: fallbackMargins, A5: fallbackMargins, EnvDL: fallbackMargins, EnvC5: fallbackMargins }

  async function call(
    code: number,
    operationAttributes: IppAttribute[],
    rest: { jobAttributes?: IppAttribute[]; data?: Uint8Array; timeoutMs?: number } = {},
  ): Promise<IppMessage> {
    const body = encodeIpp({
      version: [1, 1],
      code,
      requestId: nextRequestId++,
      data: rest.data ?? new Uint8Array(0),
      groups: [
        {
          tag: Tag.operation,
          attributes: [
            // CUPS requires this order: charset, language, target, then the rest
            attr("attributes-charset", v.charset("utf-8")),
            attr("attributes-natural-language", v.lang("en")),
            attr("printer-uri", v.uri(printerUri)),
            attr("requesting-user-name", v.name(user)),
            ...operationAttributes,
          ],
        },
        ...(rest.jobAttributes ? [{ tag: Tag.job, attributes: rest.jobAttributes }] : []),
      ],
    })
    const res = await fetch(httpUrl, {
      method: "POST",
      headers: { "content-type": "application/ipp" },
      body,
      signal: AbortSignal.timeout(rest.timeoutMs ?? 30_000),
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
    async printJob(pdf: Uint8Array, options: JobOptions): Promise<{ cupsJobId: number; details: CupsJobDetails }> {
      const envelope = options.paper === "EnvDL" || options.paper === "EnvC5"
      const reply = await call(Op.printJob, [
        attr("job-name", v.name("Print Buddy")),
        attr("document-format", v.mime("application/pdf")),
      ], {
        data: pdf,
        // Never scaling, page-ranges or number-up: the PDF already is what the preview showed.
        jobAttributes: [
          attr("copies", v.int(options.copies)),
          // 1-2-3, 1-2-3
          attr("multiple-document-handling", v.keyword("separate-documents-collated-copies")),
          // PPD options go out as names, the way `lp -o` sends them. Our paper names are the PPD's PageSize names.
          attr("ColorMode", v.name(options.color === "color" ? "Color" : "Monochrome")),
          attr("PageSize", v.name(options.paper)),
          attr("Quality", v.name(options.quality)),
          attr("MediaType", v.name(envelope ? "envelope" : "plain")),
        ],
      })
      const cupsJobId = values(reply, Tag.job, "job-id")[0]
      if (typeof cupsJobId !== "number") throw new Error("ipp: Print-Job answer without job-id")
      return { cupsJobId, details: jobDetails(reply) }
    },

    /** What CUPS knows about the job right now. */
    async getJobAttributes(cupsJobId: number): Promise<CupsJobDetails> {
      return jobDetails(await call(Op.getJobAttributes, [
        attr("job-id", v.int(cupsJobId)),
        attr("requested-attributes", ...["job-id", "job-state", "job-state-reasons", "job-printer-state-message", "job-printer-state-reasons"].map(v.keyword)),
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

    /**
     * Reads the printable margins per paper from `media-col-database` and keeps them. Call once at startup.
     * It never throws: what CUPS doesn't tell is filled with the fallback, with one warning in the log.
     */
    async loadMargins(): Promise<void> {
      let database: IppCollection[] = []
      let problem: string | undefined
      try {
        // CUPS leaves media-col-database out of `all`, so it is asked for by name
        const reply = await call(Op.getPrinterAttributes, [attr("requested-attributes", v.keyword("media-col-database"))], { timeoutMs: 5_000 })
        database = (findAttr(reply, Tag.printer, "media-col-database") ?? []).map(x => x.value as IppCollection)
        if (database.length === 0) problem = "CUPS reported no media-col-database"
      } catch (err) {
        problem = err instanceof Error ? err.message : String(err)
      }
      const read = Object.fromEntries(papers.map(paper => [paper, marginsOf(database, paper)])) as Record<Paper, Margins | undefined>
      const missing = papers.filter(paper => !read[paper])
      if (missing.length > 0) {
        console.warn(`Printable margins unknown for ${missing.join(", ")} (${problem ?? "paper not in media-col-database"}); using the A4 fallback margins.`)
      }
      margins = Object.fromEntries(papers.map(paper => [paper, read[paper] ?? fallbackMargins])) as PaperMargins
    },

    /** The printable margins per paper, as read at startup. */
    margins: (): PaperMargins => margins,

    /** What the Printer is doing right now, as CUPS sees it. */
    async printerStatus(): Promise<PrinterStatus> {
      const reply = await call(Op.getPrinterAttributes, [
        attr("requested-attributes", v.keyword("printer-state"), v.keyword("printer-state-reasons"), v.keyword("printer-state-message")),
      ])
      return {
        state: printerStates[values(reply, Tag.printer, "printer-state")[0] as number] ?? "unknown",
        reasons: values(reply, Tag.printer, "printer-state-reasons").map(String),
        message: String(values(reply, Tag.printer, "printer-state-message")[0] ?? ""),
      }
    },
  }
}
