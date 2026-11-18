import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { FileFacts } from "../shared/api.ts"

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
      const file: DraftFile = { path: join(deps.draftsDir, draftId, `${files.length + 1}.pdf`), facts: { kind: "pdf" } }
      await writeFile(file.path, bytes)
      files.push(file)
      return file.facts
    },
  }
}
