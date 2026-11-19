import { readFile } from "node:fs/promises"

export interface Config {
  /** The CUPS queue `printer_name` from the add-on options, on the CUPS host. */
  printerUri: string
  /** `upload_limit_mb` from the add-on options: largest accepted file. */
  uploadLimitMb: number
  /** Where Print Job folders live. */
  jobsDir: string
  /** Dell's engine, written by scripts/dell-engine.ts; colour photos print through it when the file is there. */
  dellEngineFile: string
  port: number
}

const defaults = {
  /** The Home Assistant host on its internal network, where the CUPS add-on listens. */
  cups: "172.30.32.1:631",
  uploadLimitMb: 50,
  optionsFile: "/data/options.json",
  jobsDir: "/share/print-buddy/jobs",
  dellEngineFile: "/share/print-buddy/dell-engine.json",
  port: 9217,
}

/**
 * Reads the add-on options file written by the HA Supervisor. A missing file or key gives the default;
 * `printer_name` has none and is required.
 * `PRINT_BUDDY_OPTIONS_FILE`, `PRINT_BUDDY_JOBS_DIR`, `PRINT_BUDDY_DELL_ENGINE`, `PRINT_BUDDY_PORT` and `PRINT_BUDDY_CUPS` (host:port)
 * move things for tests and local development.
 */
export async function loadConfig(env: Record<string, string | undefined>): Promise<Config> {
  const options = await readOptions(env.PRINT_BUDDY_OPTIONS_FILE ?? defaults.optionsFile)
  const name = options.printer_name
  if (typeof name !== "string" || name === "") {
    throw new Error("The option printer_name is missing: set it to the name of the CUPS queue in the add-on's configuration.")
  }
  return {
    printerUri: `ipp://${env.PRINT_BUDDY_CUPS ?? defaults.cups}/printers/${encodeURIComponent(name)}`,
    uploadLimitMb: typeof options.upload_limit_mb === "number" ? options.upload_limit_mb : defaults.uploadLimitMb,
    jobsDir: env.PRINT_BUDDY_JOBS_DIR ?? defaults.jobsDir,
    dellEngineFile: env.PRINT_BUDDY_DELL_ENGINE ?? defaults.dellEngineFile,
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
