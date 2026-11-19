import { createEffect, createSignal, Show } from "solid-js"
import type { PdfPreview } from "../pdf-preview.ts"

/**
 * One PDF page, drawn by pdf.js with `longSide` pixels on its longer side. Asking for more pixels draws it again;
 * the page before stays until the new one is ready. Nothing shows until the PDF is open (`pdf` is `undefined` till then).
 */
export function PdfPage(props: {
  pdf: PdfPreview | undefined
  /** Counted from 1. */
  page: number
  longSide: number
  /** What a screen reader calls the picture. Without it the picture is decoration. */
  label?: string
  /** `fill` stretches the page over its box, which then has to have the page's shape. `contain` fits it into any box. */
  fit: "fill" | "contain"
}) {
  const [canvas, setCanvas] = createSignal<HTMLCanvasElement>()
  createEffect(
    () => ({ pdf: props.pdf, page: props.page, longSide: props.longSide, fit: props.fit }),
    ({ pdf, page, longSide, fit }) => {
      let replaced = false
      void pdf?.renderPage(page, longSide).then(drawn => {
        if (replaced) return
        drawn.className = fit === "fill" ? "block size-full" : "block max-h-full max-w-full"
        setCanvas(drawn)
      })
      return () => { replaced = true }
    },
  )
  return (
    <Show when={canvas()}>
      {drawn => (
        <div
          class={props.fit === "fill" ? "size-full" : "flex size-full items-center justify-center"}
          role={props.label ? "img" : undefined}
          aria-label={props.label}
          aria-hidden={props.label ? undefined : "true"}
        >
          {drawn()}
        </div>
      )}
    </Show>
  )
}
