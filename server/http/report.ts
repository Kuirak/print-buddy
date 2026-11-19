import { Hono } from "hono"
import type { PrinterStatus, ReportFacts } from "../../shared/api.ts"
import type { PrinterClient } from "../printer/client.ts"
import { version } from "../version.ts"

/** What only the server knows for a "Bericht kopieren" report. The app builds the text (`ui/src/report.ts`). */
export function reportRoutes(deps: { printer: PrinterClient }) {
  const unknown: PrinterStatus = { state: "unknown", reasons: [], message: "" }

  return new Hono().get("/api/report", async c => {
    // a report is wanted most when something is wrong, so a silent CUPS must not cost the answer
    const printer = await deps.printer.printerStatus().catch(() => unknown)
    return c.json<ReportFacts>({ version, printer })
  })
}
