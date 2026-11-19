import "@testing-library/jest-dom/vitest"
import { cleanup } from "@solidjs/testing-library"
import { afterEach, beforeEach, vi } from "vitest"
import { fakeIndexedDb } from "./fake-indexeddb.ts"

beforeEach(() => {
  // every test starts with an empty phone storage
  vi.stubGlobal("indexedDB", fakeIndexedDb())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  // a test that opened the app after a share leaves the app's address as it found it
  history.replaceState(null, "", "/")
  localStorage.clear()
})
