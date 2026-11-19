import { For, Show } from "solid-js"
import type { Margins } from "../../../shared/api.ts"
import type { Box, Sheet, Size } from "../../../shared/layout.ts"
import type { PdfPreview } from "../pdf-preview.ts"
import { PdfPage } from "./PdfPage.tsx"

/** Where the pictures come from: the open PDF (`undefined` until pdf.js has read it), or one address per photo. */
export type PreviewSource = { kind: "pdf"; pdf: PdfPreview | undefined } | { kind: "photos"; urls: readonly string[] }

/** How high the sheet is drawn before zooming, as a share of the screen height. */
const sheetHeight = "44dvh"

/** A length of the layout module as CSS: in percent of the length it is measured against, so the drawing follows any size of the sheet. */
const percent = (part: number, whole: number) => `${(part / whole) * 100}%`

/** A box of the layout module as CSS, placed in the box it lies in. */
function boxStyle(box: Box, within: Box) {
  return {
    left: percent(box.left - within.left, within.width),
    top: percent(box.top - within.top, within.height),
    width: percent(box.width, within.width),
    height: percent(box.height, within.height),
  }
}

/**
 * One sheet as it will print: the paper in its shape, every placement of the layout module's sheet in its box,
 * turned and clipped as the layout module says, and the unprintable edge as a pale band on top.
 * It places nothing itself; it only converts points into percent of the sheet.
 * The paper shows at once; the edge and the content follow when the margins and the layout are known.
 */
export function Preview(props: {
  /** The paper's size in points. */
  paper: Size
  /** The edge of the paper the Printer can't print on. */
  margins: Margins | undefined
  /** What the layout module put on this sheet. `undefined` leaves the paper empty. */
  sheet: Sheet | undefined
  source: PreviewSource
  /** Black and white is chosen. */
  grey: boolean
  /** 1 shows the whole sheet, 2 shows it twice as large, and so on. */
  zoom: number
}) {
  // a sideways sheet (two pages per sheet) is shown turned a quarter counter-clockwise, so its pages are upright and side by side
  const sideways = () => props.sheet?.sideways ?? false
  /** Width by height of the paper as it shows on the screen. */
  const shape = () => (sideways() ? props.paper.height / props.paper.width : props.paper.width / props.paper.height)
  return (
    <div class="overflow-auto rounded-xl bg-gray-200 p-3" style={{ "max-height": `calc(${sheetHeight} + 24px)` }}>
      <div
        class="relative mx-auto overflow-hidden bg-white shadow-md"
        style={{
          "aspect-ratio": `${shape()}`,
          width: `calc(min(100%, ${sheetHeight} * ${shape()}) * ${props.zoom})`,
        }}
      >
      {/* the paper in portrait, as the layout module measures it; everything on it turns with it */}
      <div
        class="absolute top-1/2 left-1/2 overflow-hidden"
        style={{
          width: sideways() ? `${(1 / shape()) * 100}%` : "100%",
          height: sideways() ? `${shape() * 100}%` : "100%",
          transform: `translate(-50%, -50%) rotate(${sideways() ? -90 : 0}deg)`,
        }}
      >
        {/* by index: a placement that moves keeps its picture */}
        <For each={props.sheet?.placements} keyed={false}>
          {placement => (
            <div class="absolute overflow-hidden" style={boxStyle(placement().clip, { left: 0, top: 0, ...props.paper })}>
              <div class="absolute" style={boxStyle(placement(), placement().clip)}>
                {/* the upright picture, centred in its box and then turned: a quarter turn swaps its sides */}
                <div
                  class="absolute top-1/2 left-1/2"
                  style={{
                    width: placement().rotation % 180 === 0 ? "100%" : `${(placement().height / placement().width) * 100}%`,
                    height: placement().rotation % 180 === 0 ? "100%" : `${(placement().width / placement().height) * 100}%`,
                    transform: `translate(-50%, -50%) rotate(${placement().rotation}deg)`,
                    filter: props.grey ? "grayscale(1)" : "none",
                  }}
                >
                  <Show
                    when={props.source.kind === "photos" && props.source}
                    fallback={
                      <PdfPage
                        pdf={props.source.kind === "pdf" ? props.source.pdf : undefined}
                        page={placement().ref}
                        longSide={Math.min(3000, 1500 * props.zoom)}
                        label={`Vorschau Seite ${placement().ref}`}
                        fit="fill"
                      />
                    }
                  >
                    {photos => <img class="block size-full" src={photos().urls[placement().ref]} alt={`Vorschau Foto ${placement().ref + 1}`} />}
                  </Show>
                </div>
              </div>
            </div>
          )}
        </For>
        <Show when={props.margins}>
          {margins => (
            // the unprintable edge: everything outside this frame is veiled
            <div
              class="pointer-events-none absolute border border-dashed border-slate-400"
              style={{
                left: percent(margins().left, props.paper.width),
                right: percent(margins().right, props.paper.width),
                top: percent(margins().top, props.paper.height),
                bottom: percent(margins().bottom, props.paper.height),
                "box-shadow": "0 0 0 100vmax rgb(226 232 240 / 0.8)",
              }}
            />
          )}
        </Show>
      </div>
      </div>
    </div>
  )
}
