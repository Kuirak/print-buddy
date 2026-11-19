// The service worker. Built on its own into /sw.js, after the app (see vite.config.ts).
// It does three things: it takes a share and puts its files on the phone, it answers the app shell
// from its own copy, and it takes over from an older version when the app tells it to.
// Everything that can be decided without a service worker is in share-target.ts and app-update.ts.
import { takeOverMessage } from "./app-update.ts"
import { handledBy, receiveShare } from "./share-target.ts"

/**
 * Filled in by the build: the files of the app shell and a hash over their contents. The hash makes
 * /sw.js differ from build to build, which is how the browser notices a new version.
 */
declare const __APP_SHELL__: { hash: string; files: string[] }

const worker = self as unknown as ServiceWorkerGlobalScope
const shell = __APP_SHELL__
const cachePrefix = "print-buddy-shell-"
const cacheName = cachePrefix + shell.hash

worker.addEventListener("install", event => {
  // all or nothing: a version is only ready once its whole shell is on the phone
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(shell.files)))
})

worker.addEventListener("activate", event => {
  event.waitUntil(dropOlderShells())
})

async function dropOlderShells() {
  const names = await caches.keys()
  await Promise.all(names.filter(name => name.startsWith(cachePrefix) && name !== cacheName).map(name => caches.delete(name)))
}

worker.addEventListener("message", event => {
  if (event.data === takeOverMessage) event.waitUntil(takeOverIfAlone())
})

/**
 * The app asks for this only while no job is in progress in its own window. Another open window may
 * be in the middle of one, so with a second window this version keeps waiting until all are closed.
 */
async function takeOverIfAlone() {
  const windows = await worker.clients.matchAll({ type: "window", includeUncontrolled: true })
  if (windows.length <= 1) await worker.skipWaiting()
}

worker.addEventListener("fetch", event => {
  const handler = handledBy(event.request)
  if (handler === "share") event.respondWith(receiveShare(event.request))
  else if (handler === "shell") event.respondWith(fromShell(event.request))
})

/** The shell file from this version's cache. The address's query is ignored: `/?shared=1` is the page. */
async function fromShell(request: Request): Promise<Response> {
  const cache = await caches.open(cacheName)
  return (await cache.match(new URL(request.url).pathname)) ?? fetch(request)
}
