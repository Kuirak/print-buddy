import assert from "node:assert/strict"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { Readable } from "node:stream"
import { RASTERS, foo2hbpl2 } from "./printer/hbpl.ts"

/** Runs `foo2hbpl2` against a stand-in program on the PATH that records its arguments, and returns them. */
async function argumentsGiven(paper: keyof typeof RASTERS): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), "print-buddy-hbpl-"))
  const path = process.env.PATH
  try {
    await writeFile(join(dir, "foo2hbpl2"), `#!/bin/sh\nprintf '%s\\n' "$@" > "${join(dir, "args")}"\ncat > /dev/null\n`)
    await chmod(join(dir, "foo2hbpl2"), 0o755)
    process.env.PATH = `${dir}:${path}`
    await foo2hbpl2(paper, Readable.from([new Uint8Array(0)]))
    return (await readFile(join(dir, "args"), "utf8")).split("\n").filter(Boolean)
  } finally {
    process.env.PATH = path
    await rm(dir, { recursive: true, force: true })
  }
}

test("foo2hbpl2 gets the whole sheet's raster with the Printer's unprintable edge to cut off, as the CUPS queue's wrapper gives it", async () => {
  // Without -u and -l the Printer takes the raster for its printable area: the sheet is shifted by the unprintable
  // edge and its far edges fall off the paper.
  for (const paper of ["A4", "A5", "EnvDL", "EnvC5"] as const) {
    const args = await argumentsGiven(paper)
    const { clip, width, height } = RASTERS[paper]
    assert.ok(args.includes(`-u${clip.x}x${clip.y}`), `${paper}: ${args.join(" ")}`)
    assert.ok(args.includes(`-l${clip.x}x${clip.y}`), `${paper}: ${args.join(" ")}`)
    assert.ok(args.includes(`-g${width * 2}x${height}`), `${paper}: ${args.join(" ")}`)
  }
})

test("the A4 edge foo2hbpl2 cuts off is the printable margin the preview and layout use: 9 pt at the sides, 12 pt top and bottom", () => {
  const { clip } = RASTERS.A4
  // x counts 1200 dpi pixels, y rows of 600 dpi
  assert.equal((clip.x * 72) / 1200, 9)
  assert.equal((clip.y * 72) / 600, 12)
})
