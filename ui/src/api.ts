// The app's only way to the server: one function per API operation.
import type { DraftCreated, FileFacts, JobStatus, JobSubmitted, Refusal, SubmitRequest } from "../../shared/api.ts"

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

let loginExpired = () => {}

/**
 * `listener` is called whenever Cloudflare Access answers a call with 401: the monthly login has run
 * out. Every call reports it here, whoever made it, so no screen has to look for it. The call itself
 * still fails with its ApiFailure.
 */
export function onLoginExpired(listener: () => void) {
  loginExpired = listener
}

/** True for the failure of a call that Cloudflare Access answered with 401. `onLoginExpired` has heard of it by then. */
export const isLoginExpired = (failure: unknown) => failure instanceof ApiFailure && failure.status === 401

/** `body`: FormData goes out as multipart, anything else as JSON. */
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const json = body !== undefined && !(body instanceof FormData)
  const res = await fetch(path, {
    method,
    headers: {
      // makes Cloudflare Access answer 401 instead of redirecting to its login page
      "X-Requested-With": "XMLHttpRequest",
      ...(json ? { "Content-Type": "application/json" } : {}),
    },
    body: json ? JSON.stringify(body) : body,
  })
  if (res.status === 401) loginExpired()
  if (!res.ok) throw new ApiFailure(res.status, await res.json().catch(() => undefined))
  return await res.json() as T
}

/** The session check: it gets through to the server only while the login is valid. */
export const checkSession = () => call<unknown>("GET", "/api/session")

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

export const submitDraft = (draftId: string, options: SubmitRequest) => call<JobSubmitted>("POST", `/api/drafts/${draftId}/submit`, options)

export const readJob = (jobId: string) => call<JobStatus>("GET", `/api/jobs/${jobId}`)

/** Rejects with a 409 ApiFailure once the job is being printed or has ended. */
export const cancelJob = (jobId: string) => call<JobStatus>("POST", `/api/jobs/${jobId}/cancel`)
