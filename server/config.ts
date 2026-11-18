import { readFile } from "node:fs/promises"

export interface Config {
  /** `printer_uri` from the add-on options: the CUPS queue, with a numeric IP. */
  printerUri: string
  /** `upload_limit_mb` from the add-on options: largest accepted file. */
  uploadLimitMb: number
  /** Where Print Job folders live. */
  jobsDir: string
  port: number
}

const defaults = {
  printerUri: "ipp://172.30.32.1:631/printers/Printer",
  uploadLimitMb: 50,
  optionsFile: "/data/options.json",
  jobsDir: "/share/print-buddy/jobs",
  port: 9217,
}

/**
 * Reads the add-on options file written by the HA Supervisor. A missing file or key gives the default.
 * `PRINT_BUDDY_OPTIONS_FILE`, `PRINT_BUDDY_JOBS_DIR` and `PRINT_BUDDY_PORT` move things for tests and local development.
 */
export async function loadConfig(env: Record<string, string | undefined>): Promise<Config> {
  const options = await readOptions(env.PRINT_BUDDY_OPTIONS_FILE ?? defaults.optionsFile)
  return {
    printerUri: typeof options.printer_uri === "string" ? options.printer_uri : defaults.printerUri,
    uploadLimitMb: typeof options.upload_limit_mb === "number" ? options.upload_limit_mb : defaults.uploadLimitMb,
    jobsDir: env.PRINT_BUDDY_JOBS_DIR ?? defaults.jobsDir,
    port: env.PRINT_BUDDY_PORT === undefined ? defaults.port : Number(env.PRINT_BUDDY_PORT),
  }
}

async function readOptions(file: string): Promise<Record<string, unknown>> {
  let text: string
  try {
    text = await readFile(file, "utf8")
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {}
    throw err
  }
  return JSON.parse(text) as Record<string, unknown>
}
