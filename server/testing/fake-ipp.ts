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
  /** The Print-Job request that created this job; `request.data` is the document. */
  request: IppMessage
}

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
    /** answer the next request with this bare HTTP status instead of IPP */
    failNext: undefined as number | undefined,
  }
  // sizes and margins in 1/100 mm, as cupsd derives them from the PPD
  const media = (w: number, h: number) => v.col({
    "media-size": [v.col({ "x-dimension": [v.int(w)], "y-dimension": [v.int(h)] })],
    "media-bottom-margin": [v.int(423)], "media-left-margin": [v.int(318)], "media-right-margin": [v.int(318)], "media-top-margin": [v.int(423)],
  })
  const jobAttrs = (j: FakeJob, base: string): IppAttribute[] => [
    attr("job-uri", v.uri(`${base}/jobs/${j.id}`)), attr("job-id", v.int(j.id)), attr("job-state", v.enum(j.state)),
    attr("job-state-reasons", ...j.reasons.map(v.keyword)), attr("job-printer-state-message", v.text(j.message)),
    attr("job-originating-user-name", v.name(j.user)),
  ]

  const server = http.createServer((req, res) => {
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
          const j: FakeJob = { id: nextJobId++, user, state: JobState.pending, reasons: ["none"], message: "", request: msg }
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
            // A4, A5, Umschlag DL, Umschlag C5
            ...(printer.mediaColDatabase ? [attr("media-col-database", media(20990, 29704), media(14817, 20990), media(11007, 22013), media(16193, 22895))] : []),
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
    setJob(id: number, state: number, reasons: string[] = ["none"], message = "") { Object.assign(jobs.get(id)!, { state, reasons, message }) },
    close: () => new Promise<void>(r => { server.closeAllConnections(); server.close(() => r()) }),
  }
}
