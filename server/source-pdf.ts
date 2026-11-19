// An uploaded PDF, read the way a reader shows it. Upload intake and the renderer both go through this
// module, so the page sizes the app lays out are the sizes of what gets printed.
import {
  EncryptedPDFError, PDFArray, PDFBool, PDFDict, PDFDocument, PDFDropdown, PDFName, PDFNumber, PDFOptionList, PDFRef, PDFStream, PDFTextField,
  concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState,
  type PDFObject, type PDFPage,
} from "@cantoo/pdf-lib"

/** Opens an uploaded PDF. Rejects when it can't be read: corrupt, or it needs a password to open. */
export function openSourcePdf(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes).catch(err => {
    if (!(err instanceof EncryptedPDFError)) throw err
    // "owner password only" files open with an empty password; they are common and print fine
    return PDFDocument.load(bytes, { password: "" })
  })
}

/** Annotation flags (`/F`), as bit values. */
const INVISIBLE = 1
const HIDDEN = 2
const PRINT = 4

/**
 * Draws the form fields and annotations of the given pages into the pages' content, since only the content
 * is embedded. What gets drawn is what a reader prints: each one's normal appearance, fitted to its rectangle,
 * if it is flagged for printing and not hidden. One without an appearance stream is left out, except that
 * text and choice fields get the appearance a reader would make up for them.
 */
export async function drawAnnotations(doc: PDFDocument, pages: readonly PDFPage[]): Promise<void> {
  await completeFieldAppearances(doc)
  for (const page of pages) {
    const annotations = page.node.Annots()
    for (let i = 0; i < (annotations?.size() ?? 0); i++) {
      const annotation = annotations!.lookup(i)
      if (!(annotation instanceof PDFDict)) continue
      const flags = annotation.lookup(PDFName.of("F"))
      const bits = flags instanceof PDFNumber ? flags.asNumber() : 0
      const rect = numbers(annotation.lookup(PDFName.of("Rect")), 4) as Quad | undefined
      const appearance = normalAppearance(annotation)
      if (!(bits & PRINT) || bits & (HIDDEN | INVISIBLE) || !rect || !appearance) continue

      const { dict } = doc.context.lookup(appearance, PDFStream)
      const [x0, y0, x1, y1] = (numbers(dict.lookup(PDFName.of("BBox")), 4) ?? [0, 0, 1, 1]) as Quad
      const [a, b, c, d, e, f] = (numbers(dict.lookup(PDFName.of("Matrix")), 6) ?? [1, 0, 0, 1, 0, 0]) as [...Quad, number, number]
      // PDF 32000-1, 12.5.5: the appearance's box, moved by the appearance's own matrix, is fitted to the annotation's rectangle
      const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]] as const
      const xs = corners.map(([x, y]) => a * x + c * y + e)
      const ys = corners.map(([x, y]) => b * x + d * y + f)
      const [left, bottom, right, top] = [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])]
      const scaleX = (right - left) / (Math.max(...xs) - Math.min(...xs))
      const scaleY = (top - bottom) / (Math.max(...ys) - Math.min(...ys))
      // an appearance without an area has nothing to show
      if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) continue
      // drawn the way the renderer draws a page: the appearance is a picture, which its dictionary has to say
      dict.set(PDFName.of("Subtype"), PDFName.of("Form"))
      page.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(scaleX, 0, 0, scaleY, left - Math.min(...xs) * scaleX, bottom - Math.min(...ys) * scaleY),
        drawObject(page.node.newXObject("Annotation", appearance)),
        popGraphicsState(),
      )
    }
  }
}

/** The stream of an annotation's normal appearance: the one it has, or of several the one its appearance state names. */
function normalAppearance(annotation: PDFDict): PDFRef | undefined {
  const appearances = annotation.lookup(PDFName.of("AP"))
  const normal = appearances instanceof PDFDict ? appearances.get(PDFName.of("N")) : undefined
  const states = annotation.context.lookup(normal)
  if (states instanceof PDFStream) return normal instanceof PDFRef ? normal : undefined
  const state = annotation.lookup(PDFName.of("AS"))
  const chosen = states instanceof PDFDict && state instanceof PDFName ? states.get(state) : undefined
  return chosen instanceof PDFRef && annotation.context.lookup(chosen) instanceof PDFStream ? chosen : undefined
}

type Quad = [number, number, number, number]

/** The numbers of an array of exactly `count` numbers; undefined for anything else. */
function numbers(object: PDFObject | undefined, count: number): number[] | undefined {
  if (!(object instanceof PDFArray) || object.size() !== count) return undefined
  const items = Array.from({ length: count }, (_, i) => object.lookup(i))
  return items.every(item => item instanceof PDFNumber) ? items.map(item => item.asNumber()) : undefined
}

/**
 * Gives text and choice fields the appearance a reader makes up for them: where a field has none, and for all
 * of them when the form says its stored ones are out of date (`/NeedAppearances`). pdf.js does the same for
 * these field types in the preview. Password fields stay as they are stored, so their text is never printed.
 * A field pdf-lib can't draw, such as one with rich text or with a character its standard font lacks, stays as it is.
 */
async function completeFieldAppearances(doc: PDFDocument): Promise<void> {
  const acroForm = doc.catalog.lookup(PDFName.of("AcroForm"))
  if (!(acroForm instanceof PDFDict)) return
  const outOfDate = acroForm.lookup(PDFName.of("NeedAppearances")) === PDFBool.True
  const form = doc.getForm()
  const fields = form.getFields().filter(field => {
    const madeUp = field instanceof PDFTextField ? !field.isPassword() : field instanceof PDFDropdown || field instanceof PDFOptionList
    return madeUp && (outOfDate || field.needsAppearancesUpdate())
  })
  if (fields.length === 0) return
  const font = form.getDefaultFont()
  for (const field of fields) {
    try {
      field.defaultUpdateAppearances(font)
    } catch (err) {
      console.warn(`Form field ${field.getName()} keeps its stored appearance:`, err instanceof Error ? err.message : err)
    }
  }
  // the new appearances use the font, which is only written into the document here
  await doc.flush()
}
