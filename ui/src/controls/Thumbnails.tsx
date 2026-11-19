import { For, Show } from "solid-js"
import { PdfPage } from "./PdfPage.tsx"
import type { PreviewSource } from "./Preview.tsx"

/** How many pixels pdf.js draws a thumbnail's longer side with: twice its size on the screen. */
const thumbnailLongSide = 176

/**
 * The thumbnail strip: one small picture per page of the PDF or per photo, in the file's order.
 * A tap leaves one out of the printout or brings it back. The pictures show the pages and photos upright, as they are in the file.
 */
export function Thumbnails(props: {
  source: PreviewSource
  /** Every page number of the PDF (from 1) or every photo index (from 0), in order. */
  refs: readonly number[]
  /** The ones that will print. */
  selection: readonly number[]
  /** Black and white is chosen. */
  grey: boolean
  onToggle: (ref: number) => void
  onAll: () => void
  onNone: () => void
}) {
  const pdf = () => props.source.kind === "pdf"
  const small = "min-h-11 cursor-pointer rounded-lg border border-gray-300 px-3 py-2 font-semibold"
  return (
    <div class="flex flex-col gap-2">
      <div role="group" aria-label={pdf() ? "Seiten" : "Fotos"} class="flex gap-2 overflow-x-auto pb-1">
        <For each={props.refs}>
          {ref => {
            const selected = () => props.selection.includes(ref)
            // people count from 1, photo indexes from 0
            const number = () => (pdf() ? ref : ref + 1)
            return (
              <button
                type="button"
                aria-label={`${pdf() ? "Seite" : "Foto"} ${number()}`}
                aria-pressed={selected() ? "true" : "false"}
                class={`relative h-[88px] w-[62px] shrink-0 cursor-pointer overflow-hidden rounded-md border-3 bg-white ${selected() ? "border-brand" : "border-gray-300 opacity-45"}`}
                onClick={() => props.onToggle(ref)}
              >
                <div class="size-full" style={{ filter: props.grey ? "grayscale(1)" : "none" }}>
                  <Show
                    when={props.source.kind === "photos" && props.source}
                    fallback={<PdfPage pdf={props.source.kind === "pdf" ? props.source.pdf : undefined} page={ref} longSide={thumbnailLongSide} fit="contain" />}
                  >
                    {photos => <img class="block size-full object-contain" src={photos().urls[ref]} alt="" loading="lazy" decoding="async" />}
                  </Show>
                </div>
                <span
                  aria-hidden="true"
                  class={`absolute right-0 bottom-0 rounded-tl-md px-1.5 text-xs font-semibold text-white ${selected() ? "bg-brand" : "bg-gray-500"}`}
                >
                  {number()}
                </span>
              </button>
            )
          }}
        </For>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-muted mr-auto text-sm">{pdf() ? "Seiten zum Drucken antippen:" : "Fotos zum Drucken antippen:"}</span>
        <button type="button" class={small} onClick={() => props.onAll()}>Alle</button>
        <button type="button" class={small} onClick={() => props.onNone()}>Keine</button>
      </div>
    </div>
  )
}
