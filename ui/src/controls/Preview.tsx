import { createEffect, createSignal, For, Show } from "solid-js"
import type { Margins } from "../../../shared/api.ts"
import type { Box, Sheet, Size } from "../../../shared/layout.ts"
import type { PdfPreview } from "../pdf-preview.ts"

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
  return (
    <div class="overflow-auto rounded-xl bg-gray-200 p-3" style={{ "max-height": `calc(${sheetHeight} + 24px)` }}>
      <div
        class="relative mx-auto overflow-hidden bg-white shadow-md"
        style={{
          "aspect-ratio": `${props.paper.width} / ${props.paper.height}`,
          width: `calc(min(100%, ${sheetHeight} * ${props.paper.width / props.paper.height}) * ${props.zoom})`,
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
                    fallback={<PdfPage pdf={props.source.kind === "pdf" ? props.source.pdf : undefined} page={placement().ref} zoom={props.zoom} />}
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
  )
}

/** One PDF page, drawn by pdf.js. Zooming in draws it again with more pixels; the page before stays until the new one is ready. */
function PdfPage(props: { pdf: PdfPreview | undefined; page: number; zoom: number }) {
  const [canvas, setCanvas] = createSignal<HTMLCanvasElement>()
  createEffect(
    () => ({ pdf: props.pdf, page: props.page, longSide: Math.min(3000, 1500 * props.zoom) }),
    ({ pdf, page, longSide }) => {
      let replaced = false
      void pdf?.renderPage(page, longSide).then(drawn => {
        if (replaced) return
        drawn.className = "block size-full"
        setCanvas(drawn)
      })
      return () => { replaced = true }
    },
  )
  return <Show when={canvas()}>{drawn => <div class="size-full" role="img" aria-label={`Vorschau Seite ${props.page}`}>{drawn()}</div>}</Show>
}
