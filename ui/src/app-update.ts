// How the installed app gets a new version. The browser downloads a changed /sw.js in the background
// and lets it wait. This module decides when the waiting version may take over: when the app opens,
// or once the person is back on the Start screen, and never while a job is in progress.

/** Sent to the waiting service worker to tell it to take over. */
export const takeOverMessage = "take-over"

interface AppUpdate {
  /** False over plain HTTP: no service worker there, so the app can't be installed or receive shares. */
  hasServiceWorker: boolean
  /** The app says whether a job is in progress. When one has ended, a version that waited takes over. */
  setJobInProgress(inProgress: boolean): void
}

/**
 * Registers the service worker and watches for a new version. Over plain HTTP, as on the Household
 * network, browsers have no service worker: then this does nothing and the app works without one.
 */
export function startAppUpdate(): AppUpdate {
  const container: ServiceWorkerContainer | undefined = navigator.serviceWorker
  let jobInProgress = false
  let registration: ServiceWorkerRegistration | undefined

  const letWaitingTakeOver = () => {
    if (!jobInProgress) registration?.waiting?.postMessage(takeOverMessage)
  }

  if (container) {
    // the new version has taken over: load its page, unless a job began in the meantime
    container.addEventListener("controllerchange", () => {
      if (!jobInProgress) location.reload()
    })
    container.register("/sw.js").then(
      found => {
        registration = found
        letWaitingTakeOver()
        found.addEventListener("updatefound", () => {
          const installing = found.installing
          installing?.addEventListener("statechange", () => {
            if (installing.state === "installed") letWaitingTakeOver()
          })
        })
      },
      // no /sw.js here (the Vite dev server), or the browser refused it: the app works without
      () => {},
    )
  }

  return {
    hasServiceWorker: container !== undefined,
    setJobInProgress(inProgress) {
      jobInProgress = inProgress
      letWaitingTakeOver()
    },
  }
}
