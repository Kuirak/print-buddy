import { randomUUID } from "node:crypto"
import { mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { maxPhotos, type FileFacts, type PdfFacts, type Refusal, type RefusalType } from "../shared/api.ts"
import { photoFacts, sniff } from "../shared/file-header.ts"
import type { Now } from "./clock.ts"
import { openSourcePdf, shownPart } from "./source-pdf.ts"

export interface DraftFile {
  path: string
  /** Size of the file as it was uploaded. */
  bytes: number
  facts: FileFacts
}

/** What became of an uploaded file. `unknown-draft` is a caller's mistake, not a Refusal. */
type AddFileResult =
  | { outcome: "added"; facts: FileFacts }
  | { outcome: "refused"; refusal: Refusal }
  | { outcome: "unknown-draft" }

export type Intake = ReturnType<typeof createIntake>

/** How long a draft may wait for its submit. */
const keepFor = 60 * 60 * 1000

/** A draft folder's name is the draft id. */
const draftFolderName = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/

/**
 * Upload intake: collects the files of a Print Job that is not submitted yet (a draft).
 * Files are stored under generated names; the name on the phone is never kept.
 * The list of drafts is in memory: a draft doesn't outlive the server.
 */
export function createIntake(deps: { draftsDir: string; uploadLimitMb: number; now: Now }) {
  const drafts = new Map<string, { createdAt: number; files: DraftFile[] }>()
  const uploadLimitBytes = deps.uploadLimitMb * 1024 * 1024
  const tooLarge: Refusal = { refusal: "too-large", limitMb: deps.uploadLimitMb }

  return {
    /** Largest accepted file in bytes, for callers that can stop reading an upload early. */
    uploadLimitBytes,
    /** The Refusal for a file above the limit. */
    tooLarge,

    async createDraft(): Promise<string> {
      const id = randomUUID()
      // listed before its folder exists, so a cleanup that runs right now leaves the folder alone
      drafts.set(id, { createdAt: deps.now(), files: [] })
      await mkdir(join(deps.draftsDir, id), { recursive: true })
      return id
    },

    /** The draft's files in upload order, or undefined for an unknown draft. */
    files(draftId: string): readonly DraftFile[] | undefined {
      return drafts.get(draftId)?.files
    },

    /** Forgets a draft and deletes its folder. Nothing happens for an unknown draft. */
    async discard(draftId: string): Promise<void> {
      if (drafts.delete(draftId)) await rm(join(deps.draftsDir, draftId), { recursive: true, force: true })
    },

    /**
     * Deletes the drafts that were not submitted within 1 hour, and every draft folder that has no draft:
     * one that an earlier run of the server left behind can't be submitted any more.
     * Only folders named like a draft folder are looked at.
     */
    async cleanup(): Promise<void> {
      for (const [id, draft] of drafts) {
        if (deps.now() - draft.createdAt > keepFor) drafts.delete(id)
      }
      // the drafts directory appears with the first draft
      await mkdir(deps.draftsDir, { recursive: true })
      for (const name of await readdir(deps.draftsDir)) {
        if (draftFolderName.test(name) && !drafts.has(name)) await rm(join(deps.draftsDir, name), { recursive: true, force: true })
      }
    },

    /** Adds one file to the draft, or refuses it and leaves the draft as it was. */
    async addFile(draftId: string, bytes: Uint8Array): Promise<AddFileResult> {
      const files = drafts.get(draftId)?.files
      if (!files) return { outcome: "unknown-draft" }
      const refused = (refusal: Exclude<RefusalType, "too-large">): AddFileResult => ({ outcome: "refused", refusal: { refusal } })
      if (bytes.length > uploadLimitBytes) return { outcome: "refused", refusal: tooLarge }

      const type = sniff(bytes)
      if (!type) return refused("unsupported-type")
      const facts = type === "pdf" ? await pdfFacts(bytes) : await photoFacts(bytes, type)
      if (!facts) return refused("unsupported-type")

      // no await between these checks and the push, so two uploads at once can't both slip through
      const held = files[0]?.facts.kind
      if (held !== undefined && held !== facts.kind) return refused("mixed-types")
      if (held === "pdf") return refused("one-pdf-only")
      if (files.length >= maxPhotos) return refused("too-many-photos")

      const extension = facts.kind === "pdf" ? "pdf" : facts.format === "jpeg" ? "jpg" : "png"
      const file: DraftFile = { path: join(deps.draftsDir, draftId, `${files.length + 1}.${extension}`), bytes: bytes.length, facts }
      files.push(file)
      try {
        await writeFile(file.path, bytes)
      } catch (err) {
        files.splice(files.indexOf(file), 1)
        throw err
      }
      return { outcome: "added", facts }
    },
  }
}

/** Undefined when the PDF can't be read: corrupt, or it needs a password to open. */
async function pdfFacts(bytes: Uint8Array): Promise<PdfFacts | undefined> {
  try {
    const doc = await openSourcePdf(bytes)
    const pages = doc.getPages().map(page => {
      const { box, rotation } = shownPart(page)
      const [width, height] = [box.right - box.left, box.top - box.bottom]
      return rotation % 180 === 0 ? { width, height } : { width: height, height: width }
    })
    return { kind: "pdf", pageCount: pages.length, pages }
  } catch {
    return undefined
  }
}
