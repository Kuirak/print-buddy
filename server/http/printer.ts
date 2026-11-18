import { Hono } from "hono"
import type { PrinterInfo, PrinterStatus } from "../../shared/api.ts"
import type { PrinterClient } from "../printer/client.ts"

export function printerRoutes(deps: { printer: PrinterClient }) {
  const unknown: PrinterStatus = { state: "unknown", reasons: [], message: "" }

  return new Hono().get("/api/printer", async c => {
    // the margins are needed for the preview even while CUPS doesn't answer
    const status = await deps.printer.printerStatus().catch(() => unknown)
    return c.json<PrinterInfo>({ margins: deps.printer.margins(), ...status })
  })
}
