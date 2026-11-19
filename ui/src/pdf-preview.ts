// The only module that imports pdfjs-dist. Seam 3 tests never load it: the setup file replaces it with a stub.
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist"
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"

GlobalWorkerOptions.workerSrc = workerUrl

/** An open PDF, for drawing its pages on the screen. */
export interface PdfPreview {
  /**
   * Draws one page, counted from 1, the way a reader shows it (CropBox and the page's own rotation applied),
   * onto a new canvas whose longer side has `longSide` pixels.
   */
  renderPage(pageNumber: number, longSide: number): Promise<HTMLCanvasElement>
  /** Frees the PDF. Call it when the file leaves the screen. */
  destroy(): Promise<void>
}

/** Opens a PDF. pdf.js takes the bytes over, so pass a buffer nothing else needs. */
export async function openPdf(data: ArrayBuffer): Promise<PdfPreview> {
  const task = getDocument({
    data: new Uint8Array(data),
    // copied into the build by scripts/pdfjs-assets.ts; scanned pages (JBIG2, JPEG 2000) don't draw without them
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    cMapUrl: "/pdfjs/cmaps/",
    wasmUrl: "/pdfjs/wasm/",
    iccUrl: "/pdfjs/iccs/",
  })
  const doc = await task.promise
  return {
    async renderPage(pageNumber, longSide) {
      const page = await doc.getPage(pageNumber)
      const natural = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: longSide / Math.max(natural.width, natural.height) })
      const canvas = document.createElement("canvas")
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      await page.render({ canvas, viewport }).promise
      return canvas
    },
    destroy: () => task.destroy(),
  }
}
