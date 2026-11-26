import { For, Show } from "solid-js"
import type { Margins } from "../../../shared/api.ts"
import { contentPan, type Box, type Placement, type Sheet, type Size } from "../../../shared/layout.ts"
import { itemName } from "../job-text.ts"
import type { PdfPreview } from "../pdf-preview.ts"
import { PdfPage } from "./PdfPage.tsx"

/** Where the pictures come from: the open PDF (`undefined` until pdf.js has read it), or one address per photo. */
export type PreviewSource = { kind: "pdf"; pdf: PdfPreview | undefined } | { kind: "photos"; urls: readonly string[] }

/**
 * How high the sheet is drawn before zooming: under half the screen on a phone or an upright tablet, where the
 * controls follow below it, and nearly the whole height from 1024 px, where they stand beside it.
 */
const sheetHeight = "var(--sheet-height)"
const sheetHeights = "[--sheet-height:44dvh] md:[--sheet-height:50dvh] lg:[--sheet-height:calc(100dvh-10rem)]"

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

/** How far a finger has to move sideways, in CSS pixels, before it counts as a swipe to the next or previous sheet. */
const swipeDistance = 50

/** A finger that moves less than this, in CSS pixels, between down and up has tapped. */
const tapDistance = 10

/** How far the arrow keys move a panned page or photo, in points of the sheet. */
const keyPanStep = 10

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** Four arrows pointing outwards: the sign that a page or photo can be moved. */
function MoveIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" class="size-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />
    </svg>
  )
}

/**
 * One sheet as it will print: the paper in its shape, every placement of the layout module's sheet in its box,
 * turned and clipped as the layout module says, and the unprintable edge as a pale band on top.
 * It places nothing itself; it only converts points into percent of the sheet.
 * The paper shows at once; the edge and the content follow when the margins and the layout are known.
 * A tap on a page or photo picks it: every place it is shown gets an outline.
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
  /** The sheet shown, counted from 0, of `count` sheets for one copy. */
  index: number
  count: number
  /** A swipe asks for the sheet at this index; the screen shows it. */
  onStep: (index: number) => void
  /** The page or photo picked by a tap (its `ref`), outlined wherever it shows. */
  picked: number | undefined
  /** Whether a page or photo was turned by hand: it carries a small ↻. */
  turned: (ref: number) => boolean
  /** A tap on a page or photo picks it; a tap beside them gives `undefined`. */
  onPick: (ref: number | undefined) => void
  /** The picked page or photo was moved where it overlaps the border: the axes of its `pan` that changed (see `Item`). */
  onPan: (ref: number, pan: { x?: number; y?: number }) => void
}) {
  // a sideways sheet (a grid read in landscape) is shown turned a quarter counter-clockwise, so its content reads upright
  const sideways = () => props.sheet?.sideways ?? false
  /** Width by height of the paper as it shows on the screen. */
  const shape = () => (sideways() ? props.paper.height / props.paper.width : props.paper.width / props.paper.height)
  // Swiping steps the sheets only at 100 %: zoomed in, a drag pans the preview as before. A finger that hardly moves taps.
  // `touch-action` leaves vertical scrolling (and pinch zoom) to the browser and sideways moves to the app;
  // when the browser takes the gesture over for scrolling, it sends pointercancel and the swipe is dropped.
  const swipes = () => props.zoom === 1
  let start: { pointer: number; x: number; y: number } | undefined
  let paperShown: HTMLDivElement | undefined
  function down(event: PointerEvent) {
    start = event.isPrimary ? { pointer: event.pointerId, x: event.clientX, y: event.clientY } : undefined
  }
  function up(event: PointerEvent) {
    if (!start || event.pointerId !== start.pointer) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    start = undefined
    if (Math.hypot(dx, dy) < tapDistance) {
      const ref = (event.target as Element).closest<HTMLElement>("[data-ref]")?.dataset.ref
      props.onPick(ref === undefined ? undefined : Number(ref))
      return
    }
    // only a clearly sideways move counts: far enough, and more sideways than up or down
    if (!swipes() || Math.abs(dx) < swipeDistance || Math.abs(dx) <= Math.abs(dy)) return
    const to = props.index + (dx < 0 ? 1 : -1)
    if (to < 0 || to >= props.count) return
    props.onStep(to)
    // the new sheet is drawn at once; it only slides in a little from the side the finger came from
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      paperShown?.animate?.([{ transform: `translateX(${dx < 0 ? 24 : -24}px)`, opacity: 0.6 }, { transform: "none", opacity: 1 }], { duration: 150, easing: "ease-out" })
    }
  }
  const name = (ref: number) => itemName(props.source.kind, ref)
  // Panning: a drag on the overlay of the picked page or photo moves it along the axes where it overlaps the border.
  // The sheet is drawn as it is read, so a pixel of the drag is 1 / `scale` points of the layout module's read frame.
  let drag: { pointer: number; x: number; y: number; from: Placement["pan"]; pointsPerPixel: number } | undefined
  function panDown(event: PointerEvent, placement: Placement) {
    event.stopPropagation()
    const width = paperShown?.getBoundingClientRect().width ?? 0
    if (!event.isPrimary || width === 0) return
    drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, from: placement.pan, pointsPerPixel: (sideways() ? props.paper.height : props.paper.width) / width }
    ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
  }
  /** Reports a pan made along the sheet's axes (only where the content overlaps there) along the item's own. */
  function pan({ ref, pan: at }: Placement, to: { x: number; y: number }) {
    props.onPan(ref, contentPan({ ...(at.overflowX > 0 && { x: clamp01(to.x) }), ...(at.overflowY > 0 && { y: clamp01(to.y) }) }, at.rotation))
  }
  function panMove(event: PointerEvent, placement: Placement) {
    if (!drag || event.pointerId !== drag.pointer) return
    event.stopPropagation()
    const { from, pointsPerPixel } = drag
    // content moved right by `d` points: it lies `d / overflow` less far along
    pan(placement, {
      x: from.x - ((event.clientX - drag.x) * pointsPerPixel) / from.overflowX,
      y: from.y - ((event.clientY - drag.y) * pointsPerPixel) / from.overflowY,
    })
  }
  function panEnd(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointer) return
    event.stopPropagation()
    drag = undefined
  }
  const arrows: Record<string, [x: number, y: number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
  function panKey(event: KeyboardEvent, placement: Placement) {
    const arrow = arrows[event.key]
    if (!arrow) return
    event.preventDefault()
    const at = placement.pan
    pan(placement, { x: at.x - (arrow[0] * keyPanStep) / at.overflowX, y: at.y - (arrow[1] * keyPanStep) / at.overflowY })
  }
  return (
    // The tray keeps one height, whatever the sheet's shape: a sheet in landscape sits in its middle rather than shrinking
    // it, so that stepping between portrait and landscape sheets, or turning the paper, moves nothing below the preview.
    // `flex` with the paper's auto margins centres it, and still lets a zoomed sheet scroll to its every edge.
    <section
      aria-label="Vorschau"
      class={`desk flex overflow-auto rounded-2xl p-3 ${sheetHeights}`}
      style={{ height: `calc(${sheetHeight} + 24px)`, "touch-action": swipes() ? "pan-y pinch-zoom" : "auto" }}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={() => { start = undefined }}
    >
      <div
        ref={paperShown}
        class="relative m-auto shrink-0 overflow-hidden bg-paper shadow-[0_8px_24px_-8px_rgb(28_43_89/0.4)]"
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
            <div data-ref={placement().ref} class="absolute overflow-hidden" style={boxStyle(placement().clip, { left: 0, top: 0, ...props.paper })}>
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
              <Show when={props.turned(placement().ref)}>
                <span
                  role="img"
                  aria-label={`${name(placement().ref)} von Hand gedreht`}
                  class="pointer-events-none absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-brand text-xs text-white"
                >
                  ↻
                </span>
              </Show>
              <Show when={props.picked === placement().ref}>
                <div aria-hidden="true" class="pointer-events-none absolute inset-0 ring-4 ring-brand ring-inset" />
              </Show>
              <Show when={props.picked === placement().ref && (placement().pan.overflowX > 0 || placement().pan.overflowY > 0)}>
                {/* the picked page or photo overlaps the border: a drag here moves it */}
                <div
                  role="group"
                  tabindex="0"
                  aria-label={`${name(placement().ref)} verschieben`}
                  data-pan
                  class="absolute inset-0 grid cursor-move place-items-center"
                  style={{ "touch-action": "none" }}
                  onPointerDown={event => panDown(event, placement())}
                  onPointerMove={event => panMove(event, placement())}
                  onPointerUp={panEnd}
                  onPointerCancel={panEnd}
                  onKeyDown={event => panKey(event, placement())}
                >
                  <span class="pointer-events-none grid size-12 place-items-center rounded-full bg-gray-900/70 text-white">
                    <MoveIcon />
                  </span>
                </div>
              </Show>
            </div>
          )}
        </For>
        {/* cut lines, as the printout's hairlines */}
        <For each={props.sheet?.cutLines}>
          {box => <div aria-hidden="true" data-cut-line class="pointer-events-none absolute border border-gray-500" style={boxStyle(box, { left: 0, top: 0, ...props.paper })} />}
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
    </section>
  )
}
