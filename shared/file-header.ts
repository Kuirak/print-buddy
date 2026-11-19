// What the head of a file says: its type, and for a photo its pixel size and EXIF orientation. Upload intake
// decides with this, and the app reads the same facts from the phone's copy before the upload is done.
import exifr from "exifr"
import type { PhotoFacts } from "./api.ts"

/** The file type by content signature at offset 0. The name and the type the browser gives are never looked at. */
export function sniff(bytes: Uint8Array): "pdf" | "jpeg" | "png" | undefined {
  const startsWith = (signature: number[]) => signature.every((byte, i) => bytes[i] === byte)
  if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf" // %PDF-
  if (startsWith([0xff, 0xd8, 0xff])) return "jpeg"
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png"
  return undefined
}

/** Undefined when the file has the signature but no readable pixel size. */
export async function photoFacts(bytes: Uint8Array, format: "jpeg" | "png"): Promise<PhotoFacts | undefined> {
  const size = format === "jpeg" ? jpegSize(bytes) : pngSize(bytes)
  if (!size || size.width === 0 || size.height === 0) return undefined
  // exifr gives undefined for a file without EXIF data; a broken EXIF block must not cost the photo
  const orientation = await exifr.orientation(bytes).catch(() => undefined)
  return { kind: "photo", format, ...size, orientation: isOrientation(orientation) ? orientation : 1 }
}

const isOrientation = (value: number | undefined): value is PhotoFacts["orientation"] =>
  value !== undefined && Number.isInteger(value) && value >= 1 && value <= 8

/** Pixel size from the JPEG's frame header (SOFn marker). EXIF sizes are optional and can be stale after an edit. */
function jpegSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  let i = 2
  while (i + 8 < bytes.length) {
    if (bytes[i] !== 0xff) return undefined
    const marker = bytes[i + 1]!
    const isFrameHeader = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isFrameHeader) {
      return { height: (bytes[i + 5]! << 8) | bytes[i + 6]!, width: (bytes[i + 7]! << 8) | bytes[i + 8]! }
    }
    i += 2 + ((bytes[i + 2]! << 8) | bytes[i + 3]!)
  }
  return undefined
}

/** Pixel size from the PNG's IHDR chunk, which always comes first. */
function pngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 24) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}
