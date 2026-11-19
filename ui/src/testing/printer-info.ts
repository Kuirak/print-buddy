// Seam 3 helper: what the server answers when the app reads the printer info.
import type { Margins, PrinterInfo } from "../../../shared/api.ts"

/** What the server reports when CUPS gives no margins: 9 pt left and right, 12 pt top and bottom. */
const margins: Margins = { top: 12, right: 9, bottom: 12, left: 9 }

/** An idle Printer with the same margins on every paper, changed by `changes`. */
export const printerInfo = (changes: Partial<PrinterInfo> = {}): PrinterInfo => ({
  state: "idle",
  reasons: ["none"],
  message: "",
  margins: { A4: margins, A5: margins, EnvDL: margins, EnvC5: margins },
  ...changes,
})
