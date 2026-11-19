// Measures how Dell's own driver prints colour on the Dell C1765nfw and writes it as one file for Print Buddy.
//   node scripts/dell-engine.ts dell-engine.json
// Runs on a Mac with Dell's driver installed (a CUPS queue for the printer that uses Dell's PPD). Prints nothing:
// it runs a test chart through Dell's filter with cupsfilter and decodes the result with hbpldecode from foo2zjs,
// which it builds once into the temp folder unless hbpldecode is on the PATH.
// The file holds Dell's colour table and screens: it is Dell's data, so keep it out of this repository.
// Copy it to the add-on's share folder, see docs/development.md "Dell's engine".
import { execFile as execFileCb } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import sharp from "sharp"
import { ENGINE_FORMAT, GRID, TONERS, cellIndex, type DellEngine, type Screen } from "../server/dell-engine.ts"

const execFile = promisify(execFileCb)

// The chart, in pixels at 600 ppi: one patch per grid colour and per ramp step, in rows under a black frame.
const PATCH_W = 96
const PATCH_H = 24
const COLUMNS = 48
const FRAME = 8
/** Pixels at each patch edge left out of the measurement, where the driver may treat edges differently. */
const MARGIN = 6
const RAMP_STEPS = 256

/** The patch colours: every grid node, then grey, cyan, magenta and yellow ramps from paper to full. */
function chartColours(): number[][] {
  const node = (i: number) => Math.round((i * 255) / (GRID - 1))
  const colours: number[][] = []
  for (let r = 0; r < GRID; r++) for (let g = 0; g < GRID; g++) for (let b = 0; b < GRID; b++) colours.push([node(r), node(g), node(b)])
  for (const ramp of [[1, 1, 1], [1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
    for (let step = 0; step < RAMP_STEPS; step++) colours.push(ramp.map(on => (on ? 255 - step : 255)))
  }
  return colours
}

async function chartPng(colours: number[][], file: string) {
  const rows = Math.ceil(colours.length / COLUMNS)
  const width = COLUMNS * PATCH_W + 2 * FRAME
  const height = rows * PATCH_H + 2 * FRAME
  const raw = Buffer.alloc(width * height * 3, 0)
  for (const [i, colour] of colours.entries()) {
    const left = FRAME + (i % COLUMNS) * PATCH_W
    const top = FRAME + Math.floor(i / COLUMNS) * PATCH_H
    for (let y = top; y < top + PATCH_H; y++) for (let x = left; x < left + PATCH_W; x++) raw.set(colour, (y * width + x) * 3)
  }
  await sharp(raw, { raw: { width, height, channels: 3 } }).withMetadata({ density: 600 }).png().toFile(file)
  return { width, height }
}

/** The installed PPD of Dell's own driver for the C1765nfw, and its NickName. */
async function dellPpd(): Promise<{ file: string; driver: string }> {
  const dir = "/etc/cups/ppd"
  for (const name of await readdir(dir)) {
    const text = (await readFile(join(dir, name), "latin1")).replaceAll("\r", "\n")
    const nick = /^\*NickName:\s*"([^"]*)"/m.exec(text)?.[1]
    if (nick?.startsWith("Dell C1765") && text.includes("dlthm1z")) return { file: join(dir, name), driver: nick }
  }
  throw new Error("No CUPS queue with Dell's C1765nfw driver: install Dell's macOS driver and add the printer first.")
}

async function hbpldecode(): Promise<string> {
  try {
    await execFile("which", ["hbpldecode"])
    return "hbpldecode"
  } catch {}
  const dir = join(tmpdir(), "print-buddy-foo2zjs")
  const bin = join(dir, "hbpldecode")
  if (existsSync(bin)) return bin
  console.log("Building hbpldecode from foo2zjs …")
  if (!existsSync(dir)) await execFile("git", ["clone", "--quiet", "--depth", "1", "https://github.com/koenkooi/foo2zjs.git", dir])
  await execFile("cc", ["-O2", "-w", "-o", bin, "hbpldecode.c", "jbig.c", "jbig_ar.c"], { cwd: dir })
  return bin
}

/** One decoded plane: 2 bits per 600 dpi pixel, the pulse strength 0 … 3. */
interface Plane { width: number; height: number; level(x: number, y: number): number }

function readPbm(data: Buffer): Plane {
  const header = /^P4\s+(?:#[^\n]*\s+)*(\d+)\s+(\d+)\s/.exec(data.subarray(0, 200).toString("latin1"))
  if (!header) throw new Error("hbpldecode wrote no P4 bitmap")
  const bits = Number(header[1]), height = Number(header[2]), stride = Math.ceil(bits / 8), start = header[0].length
  const bit = (x: number, y: number) => (data[start + y * stride + (x >> 3)]! >> (7 - (x & 7))) & 1
  return { width: bits / 2, height, level: (x, y) => (bit(2 * x, y) << 1) | bit(2 * x + 1, y) }
}

/** A patch as measured: its pulse strengths, row by row, at page positions `left`, `top`. */
interface Patch { left: number; top: number; width: number; height: number; levels: Uint8Array; quanta: number }

function patchesOf(plane: Plane, origin: { x: number; y: number }, count: number): Patch[] {
  const patches: Patch[] = []
  for (let i = 0; i < count; i++) {
    const left = origin.x + FRAME + (i % COLUMNS) * PATCH_W + MARGIN
    const top = origin.y + FRAME + Math.floor(i / COLUMNS) * PATCH_H + MARGIN
    const width = PATCH_W - 2 * MARGIN, height = PATCH_H - 2 * MARGIN
    const levels = new Uint8Array(width * height)
    let quanta = 0
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) quanta += levels[y * width + x] = plane.level(left + x, top + y)
    patches.push({ left, top, width, height, levels, quanta })
  }
  return patches
}

const at = (p: Patch, x: number, y: number) => p.levels[y * p.width + x]!

/**
 * The toner's screen cell: the smallest lattice (`width` across, `rows` down, each band of rows shifted by `shift`)
 * on which every patch repeats exactly.
 */
function findCell(patches: Patch[]): Omit<Screen, "order"> {
  const samples = patches.filter(p => p.quanta > 0.15 * 3 * p.levels.length && p.quanta < 0.85 * 3 * p.levels.length).slice(0, 60)
  if (samples.length === 0) throw new Error("no patch with a medium amount of this toner")
  const repeats = (dx: number, dy: number) =>
    samples.every(p => {
      for (let y = 0; y + dy < p.height; y++) {
        for (let x = Math.max(0, -dx); x < p.width && x + dx < p.width; x++) if (at(p, x, y) !== at(p, x + dx, y + dy)) return false
      }
      return true
    })
  const maxWidth = PATCH_W - 2 * MARGIN - 12
  let width = 1
  while (width <= maxWidth && !repeats(width, 0)) width++
  if (width > maxWidth) throw new Error("the screen does not repeat across a patch")
  for (let rows = 1; rows < PATCH_H - 2 * MARGIN; rows++) {
    for (let shift = 0; shift < width; shift++) {
      if (repeats(shift, rows) || repeats(shift - width, rows)) return { width, rows, shift }
    }
  }
  throw new Error("the screen does not repeat down a patch")
}

/** Each patch folded onto the cell: the pulse strength per cell pixel, and the toner amount in quanta of one cell. */
function fold(patches: Patch[], cell: Omit<Screen, "order">): { quanta: number; levels: Int8Array }[] {
  const size = cell.width * cell.rows
  return patches.map(p => {
    const levels = new Int8Array(size).fill(-1)
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        const c = cellIndex(cell, p.left + x, p.top + y), v = at(p, x, y)
        if (levels[c] !== -1 && levels[c] !== v) throw new Error(`patch at ${p.left},${p.top} does not repeat on the ${cell.width}×${cell.rows} cell`)
        levels[c] = v
      }
    }
    if (levels.includes(-1)) throw new Error("a patch is smaller than the screen cell")
    return { quanta: levels.reduce((sum, v) => sum + v, 0), levels }
  })
}

/**
 * The order in which the cell's quanta (pixel × pulse strength) switch on as the toner amount rises.
 * Fails unless every patch is the first N quanta of one order: a single fixed threshold cell.
 */
function quantaOrder(patches: { quanta: number; levels: Int8Array }[], size: number): number[] {
  const folded = patches.toSorted((a, b) => a.quanta - b.quanta)
  for (let i = 1; i < folded.length; i++) {
    const before = folded[i - 1]!.levels, after = folded[i]!.levels
    if (before.some((v, c) => v > after[c]!)) throw new Error("the screen is not one threshold cell: a pixel gets lighter as the toner rises")
  }
  // A quantum's threshold: the smallest toner amount at which it is on; never on in the chart sorts last
  const threshold = (c: number, q: number) => folded.find(f => f.levels[c]! >= q)?.quanta ?? Infinity
  const quanta: { c: number; q: number; t: number }[] = []
  for (let c = 0; c < size; c++) for (let q = 1; q <= 3; q++) quanta.push({ c, q, t: threshold(c, q) })
  quanta.sort((a, b) => a.t - b.t || a.q - b.q || a.c - b.c)
  return quanta.map(({ c, q }) => c * 3 + (q - 1))
}

async function main(out: string) {
  const ppd = await dellPpd()
  const decoder = await hbpldecode()
  const work = await mkdtemp(join(tmpdir(), "print-buddy-dell-"))
  try {
    const colours = chartColours()
    const chart = await chartPng(colours, join(work, "chart.png"))
    const imageType = "Standard"
    console.log(`Running the chart through ${ppd.driver} …`)
    const { stdout } = await execFile(
      "/usr/sbin/cupsfilter",
      ["-e", "-p", ppd.file, "-m", "printer/foo", "-o", "PageSize=A4", "-o", "ColorModel=RGB", "-o", `ImageType=${imageType}`, "-o", "ppi=600", "-o", "position=top-left", join(work, "chart.png")],
      { encoding: "buffer", maxBuffer: 1 << 30 },
    )
    await writeFile(join(work, "chart.hbpl"), stdout)
    await execFile("sh", ["-c", `"${decoder}" -d plane < chart.hbpl > /dev/null`], { cwd: work })
    const planes = await Promise.all([1, 2, 3, 4].map(async n => readPbm(await readFile(join(work, `plane-01-${n}.pbm`)))))

    // The black frame: the top left inked pixel on any plane, and the frame must have the chart's size
    let origin: { x: number; y: number } | undefined
    for (let y = 0; y < planes[0]!.height && !origin; y++) {
      for (let x = 0; x < planes[0]!.width; x++) if (planes.some(p => p.level(x, y) > 0)) { origin = { x, y }; break }
    }
    if (!origin) throw new Error("Dell's driver printed nothing")
    const corner = { x: origin.x + chart.width - 1, y: origin.y + chart.height - 1 }
    if (!planes.some(p => p.level(corner.x, corner.y) > 0) || planes.some(p => p.level(corner.x + 1, corner.y) > 0)) {
      throw new Error("the chart came out scaled: its frame is not where it should be")
    }

    const engine: DellEngine = {
      format: ENGINE_FORMAT,
      about: "Dell's colour engine for the C1765nfw, measured by scripts/dell-engine.ts. Dell's data: keep it out of the repository.",
      driver: ppd.driver,
      imageType,
      measured: new Date().toISOString().slice(0, 10),
      screens: {} as DellEngine["screens"],
      table: [],
    }
    const quanta: number[][] = []
    for (const [n, toner] of TONERS.entries()) {
      const patches = patchesOf(planes[n]!, origin, colours.length)
      const cell = findCell(patches)
      const folded = fold(patches, cell)
      engine.screens[toner] = { ...cell, order: quantaOrder(folded, cell.width * cell.rows) }
      quanta.push(folded.slice(0, GRID ** 3).map(f => f.quanta))
      console.log(`${toner}: cell ${cell.width}×${cell.rows}, shift ${cell.shift}`)
    }
    engine.table = quanta[0]!.map((_, i) => quanta.map(t => t[i]!))
    await writeFile(out, JSON.stringify(engine))
    console.log(`Wrote ${out}`)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

const [out] = process.argv.slice(2)
if (out) await main(out)
else console.log("node scripts/dell-engine.ts dell-engine.json")
