import "@testing-library/jest-dom/vitest"
import { cleanup } from "@solidjs/testing-library"
import { afterEach, vi } from "vitest"
import type { PdfPreview } from "../pdf-preview.ts"

// pdf.js needs a worker and a canvas that draws, and happy-dom has neither. Every test gets this stand-in:
// any bytes open as a PDF, and every page is an empty canvas. A test reads what was asked of it with
// `vi.mocked(openPdf)`.
vi.mock("../pdf-preview.ts", () => ({
  openPdf: vi.fn(async (): Promise<PdfPreview> => ({
    renderPage: vi.fn(async () => document.createElement("canvas")),
    destroy: vi.fn(async () => {}),
  })),
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  localStorage.clear()
})
