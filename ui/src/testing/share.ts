// Seam 3 helper: a share from another app, without a phone.
import manifest from "../../public/manifest.webmanifest?raw"
import { handledBy, receiveShare } from "../share-target.ts"

/**
 * Shares files into Print Buddy the way Android does for the installed app: it sends the request the
 * manifest's `share_target` declares, the service worker's share handler answers it, and the browser
 * follows the redirect. Render `<App />` afterwards to see where the person lands.
 */
export async function share(files: File[]) {
  const target = JSON.parse(manifest).share_target
  const form = new FormData()
  for (const file of files) form.append(target.params.files[0].name, file)
  const request = new Request(new URL(target.action, location.href), { method: target.method, body: form })
  if (handledBy(request) !== "share") throw new Error("share: the service worker would let the share go to the network")

  const response = await receiveShare(request)
  if (response.status !== 303) throw new Error(`share: expected a 303, got ${response.status}`)
  history.replaceState(null, "", response.headers.get("Location"))
}
