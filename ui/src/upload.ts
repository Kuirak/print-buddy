// The upload of the phone's copy into a new draft. It runs in the background while the options screen
// shows, and its progress is what Drucken says meanwhile.
import { createSignal, type Accessor } from "solid-js"
import type { FileFacts, Refusal } from "../../shared/api.ts"
import { addFile, createDraft } from "./api.ts"

/** The phone's copy as the server holds it: `facts[i]` is what the server found out about the i-th file. */
export type Draft = { draftId: string; facts: FileFacts[] }

/** How an upload ended: every file is on the server, the server refused one of them, or it was stopped. */
export type UploadEnd = { draft: Draft } | { refusal: Refusal; file: File } | { stopped: true }

export interface Upload {
  /** The part of all files' bytes the server has, 0 to 1. */
  progress: Accessor<number>
  /** The draft, once every file is on the server. */
  draft: Accessor<Draft | undefined>
  /**
   * Settles when the upload ends. Rejects for anything else that went wrong: no answer, an error
   * status, or a 401, which `onLoginExpired` has heard of by then.
   */
  done: Promise<UploadEnd>
  /** Stops the upload. `done` then resolves as stopped, whatever the server still answers. */
  stop(): void
}

/**
 * Starts uploading the files, one per request, in their order: into a new draft, or after the files of `onto`, a
 * draft that is complete, for photos added to it. The progress counts these files only.
 */
export function startUpload(files: readonly File[], onto?: Draft): Upload {
  const stopper = new AbortController()
  const [progress, setProgress] = createSignal(0)
  const [draft, setDraft] = createSignal<Draft>()
  const total = files.reduce((sum, file) => sum + file.size, 0)

  async function run(): Promise<UploadEnd> {
    try {
      const draftId = onto?.draftId ?? (await createDraft(stopper.signal)).draftId
      const facts: FileFacts[] = [...(onto?.facts ?? [])]
      let uploaded = 0
      // one at a time, so the server holds the photos in the order they were shared or picked
      for (const file of files) {
        const onProgress = (sent: number) => setProgress(total > 0 ? (uploaded + sent * file.size) / total : 0)
        const answer = await addFile(draftId, file, { signal: stopper.signal, onProgress })
        if (stopper.signal.aborted) return { stopped: true }
        if ("refusal" in answer) return { refusal: answer, file }
        uploaded += file.size
        facts.push(answer)
      }
      const done = { draftId, facts }
      setProgress(1)
      setDraft(done)
      return { draft: done }
    } catch (failure) {
      if (stopper.signal.aborted) return { stopped: true }
      throw failure
    }
  }

  return { progress, draft, done: run(), stop: () => stopper.abort() }
}
