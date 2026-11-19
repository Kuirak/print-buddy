// Seam 3 helpers: files the browser can read its facts from, the way it does from the phone's copy.

/** Sizes of PDF pages in points, as a reader shows them. */
type PageSizes = { width: number; height: number }[]

/**
 * A PDF whose pages the stand-in for pdf.js (see setup.ts) reports with these sizes: it reads every
 * `/MediaBox [0 0 w h]` in the bytes. Without `pages`, one A4 page. `text` makes files tell apart.
 */
export function pdfFile(name: string, pages: PageSizes = [{ width: 595, height: 842 }], text = "") {
  const boxes = pages.map(({ width, height }) => `/MediaBox [0 0 ${width} ${height}]`).join(" ")
  return new File([`%PDF-1.4 ${boxes} ${text}`], name, { type: "application/pdf" })
}

/**
 * A JPEG with this pixel size and nothing else: a frame header the browser reads the size from, and no
 * EXIF data. `bytes` pads it to that file size with a comment, for tests about upload progress.
 */
export function jpegFile(name: string, width: number, height: number, bytes = 0) {
  const frame = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]
  const fixed = 2 + 4 + frame.length + 2
  const padding = Math.max(0, bytes - fixed)
  const comment = [0xff, 0xfe, (padding + 2) >> 8, (padding + 2) & 0xff, ...new Array<number>(padding).fill(0x20)]
  return new File([new Uint8Array([0xff, 0xd8, ...comment, ...frame, 0xff, 0xd9])], name, { type: "image/jpeg" })
}
