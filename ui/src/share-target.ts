// Share-to-print on the phone's side: which requests the service worker answers itself, and what it
// does with a share. No service worker globals in here, so the tests can run it.
import { phoneFiles } from "./phone-files.ts"

/** Where Android POSTs a share: `share_target.action` in `public/manifest.webmanifest`. */
const shareTargetPath = "/share-target"
/** The form field that carries the shared files: `share_target.params.files[0].name` in the manifest. */
const shareFileField = "file"
/** The app is opened with this in its address after a share, and then looks at the phone's copy. */
export const sharedParam = "shared"

/**
 * Who answers a request from the app's own origin:
 * - `share`: the service worker, with `receiveShare`.
 * - `shell`: the service worker, from its copy of the app shell (the page and what is under /assets).
 * - `network`: the server. Everything else, so API data is never answered from a cache.
 */
export function handledBy(request: Request): "share" | "shell" | "network" {
  const { pathname } = new URL(request.url)
  if (request.method === "POST" && pathname === shareTargetPath) return "share"
  if (request.method === "GET" && (pathname === "/" || pathname.startsWith("/assets/"))) return "shell"
  return "network"
}

/**
 * Takes a share: puts its files on the phone and sends the browser on into the app. The 303 turns the
 * POST into a GET, so reloading the app doesn't share again.
 */
export async function receiveShare(request: Request): Promise<Response> {
  const form = await request.formData()
  await phoneFiles.keep(form.getAll(shareFileField).filter(part => part instanceof File))
  return new Response(null, { status: 303, headers: { Location: `/?${sharedParam}=1` } })
}
