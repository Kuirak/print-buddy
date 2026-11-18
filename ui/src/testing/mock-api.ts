// Seam 3 helper: the app runs for real, and only `fetch` is replaced.
import { vi } from "vitest"

export interface ApiCall {
  method: string
  path: string
  headers: Headers
  /** The request body as the app passed it: FormData for uploads, a JSON string otherwise. */
  body: BodyInit | null | undefined
}

/** Answers one route. Anything that is not a Response is sent as JSON with status 200. */
export type ApiHandler = (call: ApiCall) => unknown

/** A JSON answer with a status other than 200, or a typed refusal. */
export const json = (body: unknown, status = 200) => Response.json(body, { status })

/**
 * Replaces `fetch` with a table of routes, keyed `"METHOD /path"`. A call to a route that is not in
 * the table rejects, so the test fails instead of hanging. The setup file removes the stub after each test.
 */
export function mockApi(routes: Record<string, ApiHandler>) {
  const calls: ApiCall[] = []
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: ApiCall = {
      method: init?.method ?? "GET",
      path: new URL(String(input), location.href).pathname,
      headers: new Headers(init?.headers),
      body: init?.body,
    }
    calls.push(call)
    const handler = routes[`${call.method} ${call.path}`]
    if (!handler) throw new Error(`mockApi: no route for ${call.method} ${call.path}`)
    const answer = await handler(call)
    return answer instanceof Response ? answer : Response.json(answer)
  })
  return {
    /** Every call the app made, in order. */
    calls,
    /** Replace or add a route while the test runs. */
    on(route: string, handler: ApiHandler) { routes[route] = handler },
  }
}
