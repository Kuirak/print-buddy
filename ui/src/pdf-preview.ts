// The only module that imports pdfjs-dist. Seam 3 tests never load it: the setup file replaces it with a stub.
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist"
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"

GlobalWorkerOptions.workerSrc = workerUrl

/** An open PDF, for reading its pages' sizes and drawing them on the screen. */
export interface PdfPreview {
  /**
   * Every page's size in points as pdf.js draws it: the part of the CropBox that lies on the page, with the
   * page's own rotation applied. The same numbers upload intake reports (`shownPart()` in server/source-pdf.ts).
   */
  pageSizes(): Promise<{ width: number; height: number }[]>
  /**
   * Draws one page, counted from 1, the way a reader prints it (CropBox and the page's own rotation applied;
   * form fields and annotations as far as they are meant for printing), onto a new canvas whose longer side
   * has `longSide` pixels.
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
    async pageSizes() {
      const sizes: { width: number; height: number }[] = []
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        const page = await doc.getPage(pageNumber)
        // pdf.js scales by the page's /UserUnit, which upload intake and the renderer leave out
        const { width, height } = page.getViewport({ scale: 1 / page.userUnit })
        sizes.push({ width, height })
      }
      return sizes
    },
    async renderPage(pageNumber, longSide) {
      const page = await doc.getPage(pageNumber)
      const natural = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: longSide / Math.max(natural.width, natural.height) })
      const canvas = document.createElement("canvas")
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      // "print" picks the form fields and annotations the server's renderer draws too (server/source-pdf.ts)
      await page.render({ canvas, viewport, intent: "print" }).promise
      return canvas
    },
    destroy: () => task.destroy(),
  }
}
