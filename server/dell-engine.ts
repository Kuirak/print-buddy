// Dell's colour engine for the C1765nfw: Dell's colour table and screens, measured from Dell's own driver by
// scripts/dell-engine.ts and read from the add-on's share folder. Dell's data never ships with Print Buddy.
import { readFile } from "node:fs/promises"

/** The Printer's toners, in the order of its planes. */
export const TONERS = ["C", "M", "Y", "K"] as const
export type Toner = (typeof TONERS)[number]

export const ENGINE_FORMAT = "print-buddy dell-engine 1"
/** Grid nodes per colour axis of the colour table. */
export const GRID = 17

/**
 * A toner's screen: a cell of `width` × `rows` pixels at 600 dpi that tiles the page, each band of `rows` rows
 * shifted right by `shift`. Every pixel has 3 quanta, one per pulse strength above none; `order` lists the cell's
 * quanta (pixel × 3 + strength − 1) in the order they switch on as the toner amount rises.
 */
export interface Screen { width: number; rows: number; shift: number; order: number[] }

/** The file scripts/dell-engine.ts writes. */
export interface DellEngine {
  format: typeof ENGINE_FORMAT
  about: string
  driver: string
  imageType: string
  measured: string
  screens: Record<Toner, Screen>
  /** Per grid node (red outermost, blue innermost, 0 … 255 in GRID steps) the C, M, Y, K amounts in quanta of a cell. */
  table: number[][]
}

/** The cell pixel a page pixel at 600 dpi belongs to. */
export function cellIndex(cell: Omit<Screen, "order">, x: number, y: number): number {
  const band = Math.floor(y / cell.rows)
  const cx = (((x - band * cell.shift) % cell.width) + cell.width) % cell.width
  return (y - band * cell.rows) * cell.width + cx
}

/** Dell's engine, ready to print with. */
export interface Engine {
  /** Dell's driver the file was measured from, and when. */
  about: string
  /**
   * Turns a run of sRGB pixels (3 bytes each) on page row `y`, starting at page column `x0`, into the Printer's
   * toner codes, one byte per 600 dpi pixel into `out` from `x0` on. A byte is two pixels of foo2hbpl2's bitcmyk
   * input at 1200 × 600: the high nibble holds the high bit of each 2-bit pulse strength, the low nibble the low
   * bit, each nibble C, M, Y, K from its top bit down.
   */
  dots(y: number, x0: number, rgb: Uint8Array, out: Uint8Array): void
}

export function engineOf(data: DellEngine): Engine {
  const screens = TONERS.map(toner => {
    const screen = data.screens[toner]
    // A quantum is on once the amount passes its place in the order
    const place = new Float32Array(screen.width * screen.rows * 3)
    for (const [i, quantum] of screen.order.entries()) place[quantum] = i + 0.5
    return { ...screen, place }
  })
  const table = new Float32Array(data.table.flat())
  const step = 255 / (GRID - 1)
  const amounts = new Float32Array(4)

  // steps between neighbouring grid nodes in `table`
  const R = GRID * GRID * 4, G = GRID * 4, B = 4

  /** The C, M, Y, K amounts of an sRGB colour, in quanta of each toner's cell: tetrahedral between 4 of the 8 grid nodes around it. */
  function amountsOf(r: number, g: number, b: number) {
    const fr = Math.min(r / step, GRID - 1.000001), fg = Math.min(g / step, GRID - 1.000001), fb = Math.min(b / step, GRID - 1.000001)
    const ir = Math.floor(fr), ig = Math.floor(fg), ib = Math.floor(fb)
    const dr = fr - ir, dg = fg - ig, db = fb - ib
    const n0 = ir * R + ig * G + ib * B, n3 = n0 + R + G + B
    // the walk from n0 to n3 goes along the largest fraction first
    let n1: number, n2: number, w0: number, w1: number, w2: number, w3: number
    if (dr >= dg && dg >= db) { n1 = n0 + R; n2 = n1 + G; w0 = 1 - dr; w1 = dr - dg; w2 = dg - db; w3 = db }
    else if (dr >= db && db >= dg) { n1 = n0 + R; n2 = n1 + B; w0 = 1 - dr; w1 = dr - db; w2 = db - dg; w3 = dg }
    else if (db >= dr && dr >= dg) { n1 = n0 + B; n2 = n1 + R; w0 = 1 - db; w1 = db - dr; w2 = dr - dg; w3 = dg }
    else if (dg >= dr && dr >= db) { n1 = n0 + G; n2 = n1 + R; w0 = 1 - dg; w1 = dg - dr; w2 = dr - db; w3 = db }
    else if (dg >= db && db >= dr) { n1 = n0 + G; n2 = n1 + B; w0 = 1 - dg; w1 = dg - db; w2 = db - dr; w3 = dr }
    else { n1 = n0 + B; n2 = n1 + G; w0 = 1 - db; w1 = db - dg; w2 = dg - dr; w3 = dr }
    for (let t = 0; t < 4; t++) amounts[t] = w0 * table[n0 + t]! + w1 * table[n1 + t]! + w2 * table[n2 + t]! + w3 * table[n3 + t]!
  }

  // per toner, while a row runs: the quantum index of the current pixel's cell row start, and its column in the cell
  const rowStart = new Int32Array(4), column = new Int32Array(4)
  // paper white needs no work when it takes no toner, as it does in Dell's table: most of a printed page is paper
  const blankPaper = data.table[data.table.length - 1]!.every(amount => amount === 0)
  return {
    about: `${data.driver}, ${data.imageType}, measured ${data.measured}`,
    dots(y, x0, rgb, out) {
      for (const [t, s] of screens.entries()) {
        const band = Math.floor(y / s.rows)
        rowStart[t] = (y - band * s.rows) * s.width * 3
        column[t] = (((x0 - band * s.shift) % s.width) + s.width) % s.width
      }
      const isPaper = (at: number) => rgb[at] === 255 && rgb[at + 1] === 255 && rgb[at + 2] === 255
      for (let i = 0, at = 0; at < rgb.length;) {
        if (blankPaper && isPaper(at)) {
          let run = 1
          while (at + run * 3 < rgb.length && isPaper(at + run * 3)) run++
          out.fill(0, x0 + i, x0 + i + run)
          for (let t = 0; t < 4; t++) column[t] = (column[t]! + run) % screens[t]!.width
          i += run
          at += run * 3
          continue
        }
        amountsOf(rgb[at]!, rgb[at + 1]!, rgb[at + 2]!)
        let byte = 0
        for (let t = 0; t < 4; t++) {
          const s = screens[t]!, amount = amounts[t]!, q = rowStart[t]! + column[t]! * 3
          const level = (s.place[q]! < amount ? 1 : 0) + (s.place[q + 1]! < amount ? 1 : 0) + (s.place[q + 2]! < amount ? 1 : 0)
          byte |= ((level >> 1) << (7 - t)) | ((level & 1) << (3 - t))
          if (++column[t]! === s.width) column[t] = 0
        }
        out[x0 + i] = byte
        i++
        at += 3
      }
    },
  }
}

/** Reads and checks the file scripts/dell-engine.ts wrote; undefined when there is no file. */
export async function loadDellEngine(file: string): Promise<Engine | undefined> {
  let text: string
  try {
    text = await readFile(file, "utf8")
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw err
  }
  const data = JSON.parse(text) as DellEngine
  if (data.format !== ENGINE_FORMAT) throw new Error(`${file} is not a Dell engine file of this Print Buddy (${ENGINE_FORMAT}): run scripts/dell-engine.ts again`)
  if (data.table?.length !== GRID ** 3 || data.table.some(node => node.length !== 4)) throw new Error(`${file}: the colour table is incomplete`)
  for (const toner of TONERS) {
    const screen = data.screens?.[toner]
    const size = screen ? screen.width * screen.rows * 3 : 0
    if (!screen || screen.order.length !== size || new Set(screen.order).size !== size) throw new Error(`${file}: the ${toner} screen is incomplete`)
  }
  return engineOf(data)
}
