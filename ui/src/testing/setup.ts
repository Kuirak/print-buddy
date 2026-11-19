import "@testing-library/jest-dom/vitest"
import { cleanup } from "@solidjs/testing-library"
import { afterEach, beforeEach, vi } from "vitest"
import type { PdfPreview } from "../pdf-preview.ts"
import { fakeIndexedDb } from "./fake-indexeddb.ts"

// pdf.js needs a worker and a canvas that draws, and happy-dom has neither. Every test gets this stand-in:
// any bytes open as a PDF, and every page is an empty canvas. A test reads what was asked of it with
// `vi.mocked(openPdf)`.
vi.mock("../pdf-preview.ts", () => ({
  openPdf: vi.fn(async (): Promise<PdfPreview> => ({
    renderPage: vi.fn(async () => document.createElement("canvas")),
    destroy: vi.fn(async () => {}),
  })),
}))

beforeEach(() => {
  // every test starts with an empty phone storage
  vi.stubGlobal("indexedDB", fakeIndexedDb())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  // a test that opened the app after a share leaves the app's address as it found it
  history.replaceState(null, "", "/")
  localStorage.clear()
})
