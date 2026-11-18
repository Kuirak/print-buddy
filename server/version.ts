import { readFileSync } from "node:fs"
import { join } from "node:path"

const addonConfig = readFileSync(join(import.meta.dirname, "..", "print-buddy", "config.yaml"), "utf8")
const match = /^version: "(.+)"$/m.exec(addonConfig)
if (!match) throw new Error("print-buddy/config.yaml has no version line")

/** The Print Buddy version, `YYYY.MM.N`. Its one source is the add-on config, which also names the image tag. */
export const version: string = match[1]!
