import { EncryptedPDFError, PDFDocument } from "@cantoo/pdf-lib"
import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { FileFacts, PdfFacts } from "../shared/api.ts"

export interface DraftFile {
  path: string
  facts: FileFacts
}

export type Intake = ReturnType<typeof createIntake>

/**
 * Upload intake: collects the files of a Print Job that is not submitted yet (a draft).
 * Files are stored under generated names; the name on the phone is never kept.
 */
export function createIntake(deps: { draftsDir: string }) {
  const drafts = new Map<string, DraftFile[]>()

  return {
    async createDraft(): Promise<string> {
      const id = randomUUID()
      await mkdir(join(deps.draftsDir, id), { recursive: true })
      drafts.set(id, [])
      return id
    },

    /** The draft's files in upload order, or undefined for an unknown draft. */
    files(draftId: string): readonly DraftFile[] | undefined {
      return drafts.get(draftId)
    },

    async addFile(draftId: string, bytes: Uint8Array): Promise<FileFacts | undefined> {
      const files = drafts.get(draftId)
      if (!files) return undefined
      const facts = await pdfFacts(bytes)
      if (!facts) return undefined
      const file: DraftFile = { path: join(deps.draftsDir, draftId, `${files.length + 1}.pdf`), facts }
      await writeFile(file.path, bytes)
      files.push(file)
      return file.facts
    },
  }
}

/** Undefined when the PDF can't be read: corrupt, or it needs a password to open. */
async function pdfFacts(bytes: Uint8Array): Promise<PdfFacts | undefined> {
  try {
    const doc = await PDFDocument.load(bytes).catch(err => {
      if (!(err instanceof EncryptedPDFError)) throw err
      // "owner password only" files open with an empty password; they are common and print fine
      return PDFDocument.load(bytes, { password: "" })
    })
    const pages = doc.getPages().map(page => {
      const { width, height } = page.getCropBox()
      const sideways = page.getRotation().angle % 180 !== 0
      return sideways ? { width: height, height: width } : { width, height }
    })
    return { kind: "pdf", pageCount: pages.length, pages }
  } catch {
    return undefined
  }
}
