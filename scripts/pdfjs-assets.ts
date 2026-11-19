// Copies the files pdf.js fetches while it draws a page (image decoders, standard fonts, character maps,
// colour profiles) from node_modules into ui/public/pdfjs, from where Vite takes them into the build.
// Without them scanned pages (JBIG2, JPEG 2000) stay empty in the preview. Runs before every build.
// pdf.js is Apache-2.0: its LICENSE goes along, so the built app and the add-on image carry the license text.
import { cp, rm } from "node:fs/promises"

const from = new URL("../node_modules/pdfjs-dist/", import.meta.url)
const to = new URL("../ui/public/pdfjs/", import.meta.url)

await rm(to, { recursive: true, force: true })
for (const folder of ["wasm", "standard_fonts", "cmaps", "iccs"]) {
  await cp(new URL(folder, from), new URL(folder, to), { recursive: true })
}
await cp(new URL("LICENSE", from), new URL("LICENSE", to))
