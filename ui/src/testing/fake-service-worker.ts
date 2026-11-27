// Seam 3 helper: stands in for `navigator.serviceWorker`. happy-dom has none, which is also what a
// phone sees over plain HTTP, so a test that doesn't call this runs the app without a service worker.
import { onTestFinished } from "vitest"

export interface FakeServiceWorkerOptions {
  /** A newer version of the app is already installed and waits to take over. */
  waiting?: boolean
  /** Registering fails, as it does where /sw.js is not served. */
  unavailable?: boolean
  /** The app is installed for the first time: no older version is running, so the one that installs is no update. */
  firstInstall?: boolean
}

/** Installs the stand-in for the running test. Call it before rendering the app. */
export function fakeServiceWorker(opts: FakeServiceWorkerOptions = {}) {
  const registered: string[] = []
  const messages: unknown[] = []
  const worker = (state: ServiceWorkerState) =>
    Object.assign(new EventTarget(), { state, postMessage: (message: unknown) => { messages.push(message) } })

  const registration = Object.assign(new EventTarget(), {
    installing: null as ReturnType<typeof worker> | null,
    active: opts.firstInstall ? null : worker("activated"),
    waiting: opts.waiting ? worker("installed") : null,
  })
  const container = Object.assign(new EventTarget(), {
    async register(url: string) {
      registered.push(url)
      if (opts.unavailable) throw new TypeError("Failed to register a ServiceWorker")
      return registration
    },
  })
  Object.defineProperty(navigator, "serviceWorker", { value: container, configurable: true })
  onTestFinished(() => { Reflect.deleteProperty(navigator, "serviceWorker") })

  return {
    /** The script addresses the app registered. */
    registered,
    /** What the app told the version that waits to take over. */
    messages,
    /** A newer version of the app has been downloaded in the background and now waits. */
    newVersionInstalled() {
      const installing = worker("installing")
      registration.installing = installing
      registration.dispatchEvent(new Event("updatefound"))
      installing.state = "installed"
      registration.installing = null
      registration.waiting = installing
      installing.dispatchEvent(new Event("statechange"))
    },
    /** The waiting version has taken over, as it does once the app told it to. */
    takeOver() {
      registration.waiting = null
      container.dispatchEvent(new Event("controllerchange"))
    },
  }
}
