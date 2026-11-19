// The facts of the phone's copy, read in the browser, so the options screen can open before the upload is
// done. The server reads the same facts again on upload, and those replace these: what prints is decided
// by the server's.
import type { FileFacts } from "../../shared/api.ts"
import { photoFacts, sniff } from "../../shared/file-header.ts"
import { openPdf } from "./pdf-preview.ts"

/**
 * The facts of each file, in order, as upload intake would report them: page sizes of a PDF as pdf.js
 * draws them, pixel size and EXIF orientation of a photo. Undefined when any file can't be read here;
 * the server then decides about it.
 */
export async function readFacts(files: readonly File[]): Promise<FileFacts[] | undefined> {
  const facts: FileFacts[] = []
  for (const file of files) {
    const fact = await readOne(file)
    if (!fact) return undefined
    facts.push(fact)
  }
  return facts
}

async function readOne(file: File): Promise<FileFacts | undefined> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const type = sniff(bytes)
  if (type !== "pdf") return type && await photoFacts(bytes, type)
  try {
    // pdf.js takes the buffer over, and nothing else needs it
    const pdf = await openPdf(bytes.buffer)
    try {
      const pages = await pdf.pageSizes()
      return { kind: "pdf", pageCount: pages.length, pages }
    } finally {
      void pdf.destroy()
    }
  } catch {
    // corrupt, or it needs a password: the server refuses it
    return undefined
  }
}
