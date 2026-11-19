// Seam 3 helper: the app runs for real, and only `fetch` and `XMLHttpRequest` (for uploads) are replaced.
import { vi } from "vitest"
import { printerInfo } from "./printer-info.ts"

export interface ApiCall {
  method: string
  path: string
  headers: Headers
  /** The request body as the app passed it: FormData for uploads, a JSON string otherwise. */
  body: BodyInit | Document | null | undefined
  /** Aborted when the app stopped the call. */
  signal: AbortSignal
}

/** Answers one route. Anything that is not a Response is sent as JSON with status 200. */
export type ApiHandler = (call: ApiCall) => unknown

/** A JSON answer with a status other than 200, or a typed refusal. */
export const json = (body: unknown, status = 200) => Response.json(body, { status })

/**
 * Replaces `fetch` and `XMLHttpRequest` with a table of routes, keyed `"METHOD /path"`. A call to a
 * route that is not in the table rejects, so the test fails instead of hanging. A handler that throws
 * is a call that got no answer, as when the network is down. The setup file removes the stubs after
 * each test. There are two exceptions, which answer unless the table has its own handler:
 * `GET /api/session`, which the app asks every time it opens, answers as for a valid login, and
 * `GET /api/printer`, which every options screen reads, answers `printerInfo()`.
 *
 * An upload through `XMLHttpRequest` reports its whole body as sent when its answer arrives, so a
 * test that holds the answer back sees the upload's progress stop before that file.
 */
export function mockApi(routes: Record<string, ApiHandler>) {
  routes = { "GET /api/session": () => ({ ok: true }), "GET /api/printer": () => printerInfo(), ...routes }
  const calls: ApiCall[] = []

  async function answer(call: ApiCall): Promise<Response> {
    calls.push(call)
    const handler = routes[`${call.method} ${call.path}`]
    if (!handler) throw new Error(`mockApi: no route for ${call.method} ${call.path}`)
    const answered = await handler(call)
    return answered instanceof Response ? answered : Response.json(answered)
  }

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) =>
    answer({
      method: init?.method ?? "GET",
      path: new URL(String(input), location.href).pathname,
      headers: new Headers(init?.headers),
      body: init?.body,
      signal: init?.signal ?? new AbortController().signal,
    }))

  /** The parts of XMLHttpRequest that `ui/src/api.ts` uses. */
  class FakeXMLHttpRequest {
    readonly upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null }
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    onabort: (() => void) | null = null
    status = 0
    responseText = ""
    #method = "GET"
    #path = ""
    #headers = new Headers()
    #stopped = new AbortController()

    open(method: string, url: string | URL) {
      this.#method = method
      this.#path = new URL(url, location.href).pathname
    }

    setRequestHeader(name: string, value: string) {
      this.#headers.set(name, value)
    }

    send(body?: Document | XMLHttpRequestBodyInit | null) {
      const signal = this.#stopped.signal
      answer({ method: this.#method, path: this.#path, headers: this.#headers, body, signal }).then(
        async response => {
          const text = await response.text()
          if (signal.aborted) return
          this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 1 } as ProgressEvent)
          this.status = response.status
          this.responseText = text
          this.onload?.()
        },
        () => {
          if (!signal.aborted) this.onerror?.()
        },
      )
    }

    abort() {
      if (this.#stopped.signal.aborted) return
      this.#stopped.abort()
      this.onabort?.()
    }
  }
  vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest)

  return {
    /** Every call the app made, in order. */
    calls,
    /** Replace or add a route while the test runs. */
    on(route: string, handler: ApiHandler) { routes[route] = handler },
  }
}
