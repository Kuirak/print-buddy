import { spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PageContent } from "../shared/api.ts"

/** A pixel counts as ink when it is darker than this (0 black, 255 paper white): a faint tint of the paper doesn't. */
const INK_BELOW = 248

/** Rendering the pages for this long at most; the pages not reached have no ink found. */
const TIME_LIMIT_MS = 30_000

/**
 * Where each page of a PDF has ink, found by rendering it with MuPDF's mutool at 72 dpi, a pixel to the point, with
 * anti-aliasing so that even a hairline leaves a mark. Like `PdfFacts.pages[].content`: the smallest rectangle
 * round the ink in points from the page's top left, `null` for a page without any, and undefined for a page that
 * could not be rendered. `sizes` are the pages' sizes as a reader shows them: a page that mutool renders at another size
 * shows another part, so nothing is claimed about it. Never rejects.
 */
export async function pageContents(bytes: Uint8Array, sizes: readonly { width: number; height: number }[]): Promise<(PageContent | null | undefined)[]> {
  const found: (PageContent | null | undefined)[] = sizes.map(() => undefined)
  let dir: string | undefined
  try {
    dir = await mkdtemp(join(tmpdir(), "print-buddy-"))
    const file = join(dir, "page.pdf")
    await writeFile(file, bytes)
    const child = spawn("mutool", ["draw", "-q", "-r", "72", "-c", "gray", "-F", "pnm", "-o", "-", file], { stdio: ["ignore", "pipe", "ignore"] })
    const timer = setTimeout(() => child.kill(), TIME_LIMIT_MS)
    const { promise: exited, resolve } = Promise.withResolvers<void>()
    child.on("error", () => resolve())
    child.on("close", () => resolve())
    // P5 rasters, one after the other: "P5 <width> <height> 255" and one whitespace byte, then a byte per pixel
    let pending: Buffer = Buffer.alloc(0)
    let page = 0
    try {
      for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
        pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])
        for (;;) {
          const match = /^P5\s+(\d+)\s+(\d+)\s+255\s/.exec(pending.subarray(0, 64).toString("latin1"))
          if (!match) break
          const [width, height] = [Number(match[1]), Number(match[2])]
          const end = match[0].length + width * height
          if (pending.length < end) break
          const size = sizes[page]
          // mutool rounds a page's size up to whole pixels
          if (size && Math.abs(width - size.width) <= 1 && Math.abs(height - size.height) <= 1) {
            found[page] = inkOf(pending.subarray(match[0].length, end), width, height, size)
          }
          pending = pending.subarray(end)
          page++
        }
      }
    } finally {
      clearTimeout(timer)
      if (child.exitCode === null) child.kill()
      await exited
    }
  } catch {
    // no mutool, or it failed: what was found stands, the rest is unknown
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true })
  }
  return found
}

/** The ink of one rendered page, as points on the page `size` it shows. */
function inkOf(pixels: Uint8Array, width: number, height: number, size: { width: number; height: number }): PageContent | null {
  let left = width, top = height, right = -1, bottom = -1
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      if (pixels[row + x]! >= INK_BELOW) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  if (right < 0) return null
  // whole pixels, so the rectangle never falls short of the ink; a pixel is a point, up to the rounding of the page size
  const [sx, sy] = [size.width / width, size.height / height]
  return { left: left * sx, top: top * sy, right: Math.min(size.width, (right + 1) * sx), bottom: Math.min(size.height, (bottom + 1) * sy) }
}
