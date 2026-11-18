// In-process fake IPP printer for Seam 1. It answers like cupsd 2.4.10 (shapes copied from a real cupsd),
// records every request, and lets a test script job and printer state.
import http from "node:http"
import type { AddressInfo } from "node:net"
import {
  JobState, Op, PrinterState, Status, Tag, attr, decodeIpp, encodeIpp, v, values,
  type IppAttribute, type IppGroup, type IppMessage,
} from "../printer/ipp-codec.ts"

export interface FakeJob {
  id: number
  user: string
  state: number
  reasons: string[]
  message: string
  /** `job-printer-state-reasons`: what the printer reports while it has the job. */
  printerReasons: string[]
  /** The Print-Job request that created this job; `request.data` is the document. */
  request: IppMessage
}

/** One entry of `media-col-database`: sheet size and printable margins, in 1/100 mm. */
export interface FakeMedia { width: number; height: number; top: number; right: number; bottom: number; left: number }

export type FakeIpp = Awaited<ReturnType<typeof startFakeIpp>>

export async function startFakeIpp(queue = "Test_Printer") {
  const requests: IppMessage[] = []
  const jobs = new Map<number, FakeJob>()
  let nextJobId = 1
  const printer = {
    state: PrinterState.idle as number,
    reasons: ["none"],
    message: "",
    /** false: answer Get-Printer-Attributes without `media-col-database` */
    mediaColDatabase: true,
    /**
     * The entries of `media-col-database`, with the numbers cupsd derives from the PPD:
     * A4, A5, Umschlag DL, Umschlag C5, all with the margins of the real Printer's A4.
     */
    media: [[20990, 29704], [14817, 20990], [11007, 22013], [16193, 22895]].map(([width, height]): FakeMedia => (
      { width: width!, height: height!, top: 423, right: 318, bottom: 423, left: 318 }
    )),
    /** answer the next request with this bare HTTP status instead of IPP */
    failNext: undefined as number | undefined,
    /** true: drop every connection without an answer, like a CUPS that is down */
    unreachable: false,
    /** false: refuse Print-Job the way a queue does that rejects jobs */
    acceptingJobs: true,
  }
  const media = (m: FakeMedia) => v.col({
    "media-size": [v.col({ "x-dimension": [v.int(m.width)], "y-dimension": [v.int(m.height)] })],
    "media-bottom-margin": [v.int(m.bottom)], "media-left-margin": [v.int(m.left)], "media-right-margin": [v.int(m.right)], "media-top-margin": [v.int(m.top)],
  })
  const jobAttrs = (j: FakeJob, base: string): IppAttribute[] => [
    attr("job-uri", v.uri(`${base}/jobs/${j.id}`)), attr("job-id", v.int(j.id)), attr("job-state", v.enum(j.state)),
    attr("job-state-reasons", ...j.reasons.map(v.keyword)), attr("job-printer-state-message", v.text(j.message)),
    attr("job-originating-user-name", v.name(j.user)), attr("job-printer-state-reasons", ...j.printerReasons.map(v.keyword)),
  ]

  const server = http.createServer((req, res) => {
    if (printer.unreachable) { req.socket.destroy(); return }
    const chunks: Buffer[] = []
    req.on("data", c => chunks.push(c)).on("end", () => {
      const msg = decodeIpp(Buffer.concat(chunks))
      requests.push(msg)
      const base = `ipp://${req.headers.host}`
      const user = String(values(msg, Tag.operation, "requesting-user-name")[0] ?? "anonymous")
      const reply = (code: number, groups: IppGroup[] = [], statusMessage?: string) => {
        const op = [attr("attributes-charset", v.charset("utf-8")), attr("attributes-natural-language", v.lang("en"))]
        if (statusMessage) op.push(attr("status-message", v.text(statusMessage)))
        res.writeHead(200, { "content-type": "application/ipp" })
        res.end(encodeIpp({ version: msg.version, code, requestId: msg.requestId, groups: [{ tag: Tag.operation, attributes: op }, ...groups], data: new Uint8Array(0) }))
      }
      if (printer.failNext !== undefined) { const s = printer.failNext; printer.failNext = undefined; res.writeHead(s).end(); return }
      if (req.url !== `/printers/${queue}`) return reply(Status.notFound, [], "The printer or class does not exist.")
      const job = jobs.get(values(msg, Tag.operation, "job-id")[0] as number)
      switch (msg.code) {
        case Op.printJob: {
          if (!printer.acceptingJobs) return reply(Status.notAcceptingJobs, [], `Destination "${queue}" is not accepting jobs.`)
          const j: FakeJob = { id: nextJobId++, user, state: JobState.pending, reasons: ["none"], message: "", printerReasons: ["none"], request: msg }
          jobs.set(j.id, j)
          return reply(Status.ok, [{ tag: Tag.job, attributes: jobAttrs(j, base).slice(0, 4) }])
        }
        case Op.getJobAttributes:
          if (!job) return reply(Status.notFound, [], "Job does not exist.")
          return reply(Status.ok, [{ tag: Tag.job, attributes: jobAttrs(job, base) }])
        case Op.cancelJob:
          if (!job) return reply(Status.notFound, [], "Job does not exist.")
          // real cupsd refuses a non-owner at HTTP level (401 or 426), with no IPP body
          if (job.user !== user) { res.writeHead(401, { "www-authenticate": 'Basic realm="CUPS"' }).end(); return }
          if (job.state >= JobState.canceled) return reply(Status.notPossible, [], `Job #${job.id} is already canceled - can't cancel.`)
          job.state = JobState.canceled
          return reply(Status.ok)
        case Op.getPrinterAttributes:
          return reply(Status.ok, [{ tag: Tag.printer, attributes: [
            attr("printer-state", v.enum(printer.state)), attr("printer-state-reasons", ...printer.reasons.map(v.keyword)), attr("printer-state-message", v.text(printer.message)),
            // like cupsd, only when asked for by name: `all` leaves it out
            ...(printer.mediaColDatabase && printer.media.length > 0 && values(msg, Tag.operation, "requested-attributes").includes("media-col-database")
              ? [attr("media-col-database", ...printer.media.map(media))]
              : []),
          ] }])
        default:
          return reply(Status.operationNotSupported, [], "operation-not-supported")
      }
    })
  })
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r))
  const port = (server.address() as AddressInfo).port
  return {
    /** Use as `printer_uri`. */
    uri: `ipp://127.0.0.1:${port}/printers/${queue}`,
    /** Every IPP request received, in order. */
    requests,
    jobs,
    printer,
    setJob(id: number, state: number, reasons: string[] = ["none"], message = "", printerReasons: string[] = ["none"]) {
      Object.assign(jobs.get(id)!, { state, reasons, message, printerReasons })
    },
    close: () => new Promise<void>(r => { server.closeAllConnections(); server.close(() => r()) }),
  }
}
