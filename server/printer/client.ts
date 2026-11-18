import { Op, Status, Tag, attr, decodeIpp, encodeIpp, v, values, type IppAttribute, type IppMessage } from "./ipp-codec.ts"

/** Every request to CUPS is made as this user, so Print Buddy owns its jobs and may cancel them. */
const user = "print-buddy"

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
    if (res.status !== 200) throw new Error(`ipp: http ${res.status}`)
    const reply = decodeIpp(new Uint8Array(await res.arrayBuffer()))
    if (reply.code !== Status.ok) {
      throw new Error(`ipp: status 0x${reply.code.toString(16).padStart(4, "0")} ${String(values(reply, Tag.operation, "status-message")[0] ?? "")}`)
    }
    return reply
  }

  return {
    /** Sends the PDF as one job and returns the job number CUPS assigned. */
    async printJob(pdf: Uint8Array): Promise<{ cupsJobId: number }> {
      const reply = await call(Op.printJob, [
        attr("job-name", v.name("Print Buddy")),
        attr("document-format", v.mime("application/pdf")),
      ], pdf)
      const cupsJobId = values(reply, Tag.job, "job-id")[0]
      if (typeof cupsJobId !== "number") throw new Error("ipp: Print-Job answer without job-id")
      return { cupsJobId }
    },
  }
}
