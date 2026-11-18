// The app's only way to the server: one function per API operation.
import type { DraftCreated, FileFacts, JobSubmitted, Refusal } from "../../shared/api.ts"

/** The server (or Cloudflare Access, with 401) answered with an error status. */
export class ApiFailure extends Error {
  status: number
  /** The parsed JSON body, if there was one. */
  body: unknown

  constructor(status: number, body: unknown) {
    super(`API ${status}`)
    this.status = status
    this.body = body
  }
}

async function call<T>(method: string, path: string, body?: BodyInit): Promise<T> {
  const res = await fetch(path, {
    method,
    // makes Cloudflare Access answer 401 instead of redirecting to its login page
    headers: { "X-Requested-With": "XMLHttpRequest" },
    body,
  })
  if (!res.ok) throw new ApiFailure(res.status, await res.json().catch(() => undefined))
  return await res.json() as T
}

export const createDraft = () => call<DraftCreated>("POST", "/api/drafts")

/** Resolves with the file's facts, or with the Refusal when the server won't take the file. */
export async function addFile(draftId: string, file: File): Promise<FileFacts | Refusal> {
  const form = new FormData()
  form.set("file", file)
  try {
    return await call<FileFacts>("POST", `/api/drafts/${draftId}/files`, form)
  } catch (err) {
    const body = err instanceof ApiFailure ? err.body : undefined
    if (typeof body === "object" && body !== null && "refusal" in body) return body as Refusal
    throw err
  }
}

export const submitDraft = (draftId: string) => call<JobSubmitted>("POST", `/api/drafts/${draftId}/submit`)
