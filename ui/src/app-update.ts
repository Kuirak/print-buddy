// How the installed app gets a new version. The browser downloads a changed /sw.js in the background
// and lets it wait. This module decides when the waiting version may take over: when the app opens,
// or once the person is back on the Start screen, and never while a job is in progress. It also says
// what the person should hear: that a version waits for the job to end, and that the page has just been
// reloaded into a new one.

/** Sent to the waiting service worker to tell it to take over. */
export const takeOverMessage = "take-over"

interface AppUpdate {
  /** False over plain HTTP: no service worker there, so the app can't be installed or receive shares. */
  hasServiceWorker: boolean
  /** This page was loaded because a new version took over: it opens with a new version, say so once. */
  updated: boolean
  /** The app says whether a job is in progress. When one has ended, a version that waited takes over. */
  setJobInProgress(inProgress: boolean): void
}

/** What the take-over leaves in `localStorage` for the page it reloads into. */
const updatedMark = "print-buddy-updated"

/** Whether the take-over reloaded this page. The mark goes with the answer, so that the next page load says nothing. */
function takeUpdatedMark(): boolean {
  try {
    const marked = localStorage.getItem(updatedMark) !== null
    localStorage.removeItem(updatedMark)
    return marked
  } catch {
    // no storage, as in some private windows: the person simply isn't told
    return false
  }
}

function leaveUpdatedMark() {
  try {
    localStorage.setItem(updatedMark, "1")
  } catch {
    // see takeUpdatedMark
  }
}

/**
 * Registers the service worker and watches for a new version. Over plain HTTP, as on the Household
 * network, browsers have no service worker: then this does nothing and the app works without one.
 * `onHeldBack` is called once, when a new version is ready but a job in progress keeps it waiting.
 */
export function startAppUpdate(onHeldBack?: () => void): AppUpdate {
  const container: ServiceWorkerContainer | undefined = navigator.serviceWorker
  let jobInProgress = false
  let saidHeldBack = false
  let registration: ServiceWorkerRegistration | undefined
  const updated = takeUpdatedMark()

  const letWaitingTakeOver = () => {
    const waiting = registration?.waiting
    if (!waiting) return
    if (!jobInProgress) waiting.postMessage(takeOverMessage)
    else if (!saidHeldBack) {
      saidHeldBack = true
      onHeldBack?.()
    }
  }

  if (container) {
    // the new version has taken over: load its page, unless a job began in the meantime
    container.addEventListener("controllerchange", () => {
      if (jobInProgress) return
      leaveUpdatedMark()
      location.reload()
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
    updated,
    setJobInProgress(inProgress) {
      jobInProgress = inProgress
      letWaitingTakeOver()
    },
  }
}
