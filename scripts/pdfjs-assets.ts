// Copies the files pdf.js fetches while it draws a page (image decoders, standard fonts, character maps,
// colour profiles) from node_modules into ui/public/pdfjs, from where Vite takes them into the build.
// Without them scanned pages (JBIG2, JPEG 2000) stay empty in the preview. Runs before every build.
import { cp, rm } from "node:fs/promises"

const from = new URL("../node_modules/pdfjs-dist/", import.meta.url)
const to = new URL("../ui/public/pdfjs/", import.meta.url)

await rm(to, { recursive: true, force: true })
for (const folder of ["wasm", "standard_fonts", "cmaps", "iccs"]) {
  await cp(new URL(folder, from), new URL(folder, to), { recursive: true })
}
