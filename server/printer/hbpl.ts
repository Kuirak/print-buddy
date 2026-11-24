import { spawn } from "node:child_process"
import type { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { Paper } from "../../shared/print-options.ts"

/** One pixel of the Printer's raster, 1/600 in, in points. */
export const DOT = 72 / 600

/**
 * The Printer's raster for each paper, as foo2hbpl2-wrapper sizes it: `width` 600 dpi pixels across (bytes of one
 * bitcmyk row, 1200 dpi pixels at 4 bits each), `height` rows at 600 dpi, `code` foo2hbpl2's paper number.
 * `clip` is the wrapper's unprintable edge for that paper, `-u`/`-l` on each side: `x` in 1200 dpi pixels, `y` in rows.
 */
export const RASTERS: Record<Paper, { width: number; height: number; code: number; clip: { x: number; y: number } }> = {
  A4: { width: 4960, height: 7016, code: 1, clip: { x: 150, y: 100 } },
  A5: { width: 3496, height: 4960, code: 3, clip: { x: 168, y: 100 } },
  EnvDL: { width: 2600, height: 5200, code: 12, clip: { x: 168, y: 100 } },
  EnvC5: { width: 3825, height: 5408, code: 11, clip: { x: 150, y: 100 } },
}

/** Packs sheets of bitcmyk rows (`RASTERS[paper]` each, back to back) into the Printer's own language, HBPL. */
export type HbplEncoder = (paper: Paper, raster: Readable) => Promise<Uint8Array>

/**
 * foo2hbpl2 from foo2zjs, a separate program in the add-on image. Without -A and -B, unlike the CUPS queue:
 * colour toner may lie under black, and each 600 dpi pixel keeps its 2-bit pulse strength per toner.
 * With the wrapper's -u and -l, like the CUPS queue: HBPL carries no offset, so the Printer must get only the
 * printable area, which it puts at its printable area. Given the whole sheet, it shifts it by the unprintable edge,
 * and the far edge of the layout's printable area falls off the paper.
 */
export const foo2hbpl2: HbplEncoder = async (paper, raster) => {
  const { width, height, code, clip } = RASTERS[paper]
  const envelope = paper === "EnvDL" || paper === "EnvC5"
  const edge = `${clip.x}x${clip.y}`
  const child = spawn("foo2hbpl2", [
    "-r1200x600", `-g${width * 2}x${height}`, `-p${code}`, `-m${envelope ? 6 : 1}`, "-n1", "-d1", "-s1", "-z0", `-u${edge}`, `-l${edge}`,
    "-c", "-J", "Print Buddy",
  ], { stdio: ["pipe", "pipe", "pipe"] })
  const out: Buffer[] = [], err: Buffer[] = []
  child.stdout.on("data", (chunk: Buffer) => out.push(chunk))
  child.stderr.on("data", (chunk: Buffer) => err.push(chunk))
  const exited = new Promise<number>((resolve, reject) => {
    child.on("error", reject)
    child.on("close", code => resolve(code ?? -1))
  })
  const fed = pipeline(raster, child.stdin)
  const [status] = await Promise.all([exited, fed.catch(async (feedErr: unknown) => {
    // a foo2hbpl2 that died early closes its input; its exit status says why
    child.kill()
    throw feedErr
  })])
  if (status !== 0) throw new Error(`foo2hbpl2 failed (${status}): ${Buffer.concat(err).toString().trim()}`)
  return Buffer.concat(out)
}
