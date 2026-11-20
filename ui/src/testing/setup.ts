import "@testing-library/jest-dom/vitest"
import { cleanup } from "@solidjs/testing-library"
import { afterEach, beforeEach, vi } from "vitest"
import type { PdfPreview } from "../pdf-preview.ts"
import { fakeIndexedDb } from "./fake-indexeddb.ts"

// pdf.js needs a worker and a canvas that draws, and happy-dom has neither. Like `fetch`, it is a boundary
// that every test gets a stand-in for: any bytes open as a PDF, and a page is "drawn" as an empty canvas that
// says what it was asked to show. `data-pdf` is the file's bytes as text, `data-page` the page number, and the
// canvas is as wide as the pixels asked for. A test reads these from the canvases on the screen.
// The pages have the sizes of the `/MediaBox [0 0 w h]` entries in the bytes (`pdfFile()` in files.ts writes
// them), or one A4 page when there are none.
vi.mock("../pdf-preview.ts", () => ({
  async openPdf(data: ArrayBuffer): Promise<PdfPreview> {
    const pdf = new TextDecoder().decode(data)
    const boxes = [...pdf.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map(([, width, height]) => ({ width: Number(width), height: Number(height) }))
    return {
      async pageSizes() {
        return boxes.length > 0 ? boxes : [{ width: 595, height: 842 }]
      },
      async renderPage(pageNumber, longSide) {
        const canvas = document.createElement("canvas")
        Object.assign(canvas.dataset, { pdf, page: String(pageNumber) })
        canvas.width = longSide
        return canvas
      },
      async destroy() {},
    }
  },
}))

// happy-dom makes up an address for a file's picture. This one says which file it shows: "blob:Strand 1.jpg".
URL.createObjectURL = file => `blob:${(file as File).name}`

// happy-dom lays nothing out, and its IntersectionObserver never calls back. Here every element is on the screen
// as soon as it is watched, so whatever waits to scroll into view shows at once.
globalThis.IntersectionObserver = class {
  readonly #callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) {
    this.#callback = callback
  }
  observe(target: Element) {
    queueMicrotask(() => this.#callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver))
  }
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
} as unknown as typeof IntersectionObserver

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
