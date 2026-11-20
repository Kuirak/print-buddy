import { spawn } from "node:child_process"

/**
 * A page of a PDF file as sRGB rows at 600 dpi, `width` × `height` pixels from the page's top left. MuPDF's mutool
 * renders it, without anti-aliasing: that comes closest to the raster macOS hands Dell's driver. A row past the
 * rendered page is paper white; what the page has past `width` or `height` is dropped. Each row is only valid until
 * the next one is asked for.
 */
export async function* pdfPageRows(file: string, page: number, width: number, height: number): AsyncGenerator<Uint8Array> {
  const child = spawn("mutool", ["draw", "-q", "-r", "600", "-c", "rgb", "-A", "0", "-F", "pnm", "-o", "-", file, String(page)], {
    stdio: ["ignore", "pipe", "pipe"],
  })
  const err: Buffer[] = []
  child.stderr.on("data", (chunk: Buffer) => err.push(chunk))
  const exited = new Promise<number>((resolve, reject) => {
    child.on("error", reject)
    child.on("close", code => resolve(code ?? -1))
  })
  // awaited only when the rows run out; a failed start then shows there
  exited.catch(() => {})
  const row = new Uint8Array(width * 3).fill(255)
  let y = 0
  try {
    // the header, "P6 <width> <height> 255" and one whitespace byte, then the rows, 3 bytes per pixel
    let header = Buffer.alloc(0)
    let source: { stride: number; height: number } | undefined
    let filled = 0, sourceY = 0
    for await (let chunk of child.stdout as AsyncIterable<Buffer>) {
      if (!source) {
        header = Buffer.concat([header, chunk])
        const match = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(header.subarray(0, 64).toString("latin1"))
        if (!match) {
          if (header.length > 64) throw new Error("mutool wrote no RGB raster")
          continue
        }
        source = { stride: Number(match[1]) * 3, height: Number(match[2]) }
        chunk = header.subarray(match[0].length)
      }
      for (let at = 0; at < chunk.length;) {
        const take = Math.min(chunk.length - at, source.stride - filled)
        // the part of the source row the raster holds
        const keep = Math.max(0, Math.min(take, row.length - filled))
        if (keep > 0) row.set(chunk.subarray(at, at + keep), filled)
        filled += take
        at += take
        if (filled === source.stride) {
          filled = 0
          sourceY++
          if (y < height) {
            yield row
            y++
            row.fill(255)
          }
        }
      }
      if (y === height) break
    }
    if (y < height) {
      const status = await exited
      if (status !== 0 || !source || sourceY < source.height) {
        throw new Error(`mutool failed (${status}): ${Buffer.concat(err).toString().trim()}`)
      }
      for (; y < height; y++) yield row
    }
  } finally {
    // stopped early, or the page has more rows than the raster
    if (child.exitCode === null) child.kill()
  }
}
