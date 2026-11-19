// The app's only way to the server: one function per API operation.
import type { DraftCreated, FileFacts, JobStatus, JobSubmitted, PrinterInfo, Refusal, ReportFacts, SubmitRequest } from "../../shared/api.ts"

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

/** Sent with every call: makes Cloudflare Access answer 401 instead of redirecting to its login page. */
const appHeader = { "X-Requested-With": "XMLHttpRequest" }

/** `body` goes out as JSON. `signal` stops the call. */
async function call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const json = body !== undefined
  const res = await fetch(path, {
    method,
    headers: { ...appHeader, ...(json ? { "Content-Type": "application/json" } : {}) },
    body: json ? JSON.stringify(body) : undefined,
    signal,
  })
  if (res.status === 401) loginExpired()
  if (!res.ok) throw new ApiFailure(res.status, await res.json().catch(() => undefined))
  return await res.json() as T
}

/** How an upload is watched and stopped. */
export type UploadControl = {
  /** Stops the upload; it then rejects with an AbortError. */
  signal?: AbortSignal
  /** Called as the request body goes out, with the part of it sent so far, 0 to 1. */
  onProgress?: (sent: number) => void
}

/**
 * Posts a multipart body through XMLHttpRequest, which reports how far the body has gone (fetch can't).
 * Answers the way `call` does: a 401 is reported to `onLoginExpired`, any error status rejects with its
 * ApiFailure, and no answer at all rejects with a TypeError, as fetch does.
 */
function upload<T>(path: string, form: FormData, { signal, onProgress }: UploadControl): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>()
  const abortError = () => signal?.reason ?? new DOMException("The upload was stopped.", "AbortError")
  if (signal?.aborted) {
    reject(abortError())
    return promise
  }
  const xhr = new XMLHttpRequest()
  xhr.open("POST", path)
  for (const [name, value] of Object.entries(appHeader)) xhr.setRequestHeader(name, value)
  xhr.upload.onprogress = event => {
    if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total)
  }
  xhr.onload = () => {
    if (xhr.status === 401) loginExpired()
    const ok = xhr.status >= 200 && xhr.status < 300
    let body: unknown
    try {
      body = JSON.parse(xhr.responseText)
    } catch (err) {
      // as with fetch: an answer that isn't JSON fails as itself when the status is fine
      if (ok) return reject(err)
    }
    if (ok) resolve(body as T)
    else reject(new ApiFailure(xhr.status, body))
  }
  xhr.onerror = () => reject(new TypeError("The upload got no answer."))
  xhr.onabort = () => reject(abortError())
  signal?.addEventListener("abort", () => xhr.abort(), { once: true })
  xhr.send(form)
  return promise
}

/** The session check: it gets through to the server only while the login is valid. */
export const checkSession = () => call<unknown>("GET", "/api/session")

export const createDraft = (signal?: AbortSignal) => call<DraftCreated>("POST", "/api/drafts", undefined, signal)

/** Resolves with the file's facts, or with the Refusal when the server won't take the file. */
export async function addFile(draftId: string, file: File, control: UploadControl = {}): Promise<FileFacts | Refusal> {
  const form = new FormData()
  form.set("file", file)
  try {
    return await upload<FileFacts>(`/api/drafts/${draftId}/files`, form, control)
  } catch (err) {
    const body = err instanceof ApiFailure ? err.body : undefined
    if (typeof body === "object" && body !== null && "refusal" in body) return body as Refusal
    throw err
  }
}

export const submitDraft = (draftId: string, options: SubmitRequest) => call<JobSubmitted>("POST", `/api/drafts/${draftId}/submit`, options)

/** The printable margins of each paper, and the Printer's state. */
export const readPrinter = () => call<PrinterInfo>("GET", "/api/printer")

export const readJob = (jobId: string) => call<JobStatus>("GET", `/api/jobs/${jobId}`)

/** Rejects with a 409 ApiFailure once the job is being printed or has ended. */
export const cancelJob = (jobId: string) => call<JobStatus>("POST", `/api/jobs/${jobId}/cancel`)

/** The server's part of a "Bericht kopieren" report. */
export const readReportFacts = () => call<ReportFacts>("GET", "/api/report")
