import { createSignal, For, onSettled, Show } from "solid-js"
import { maxCount } from "../../../shared/print-options.ts"
import { itemName } from "../job-text.ts"
import { FadingRow } from "./FadingRow.tsx"
import { PdfPage } from "./PdfPage.tsx"
import type { PreviewSource } from "./Preview.tsx"

/** How many pixels pdf.js draws a thumbnail's longer side with: twice its size on the screen. */
const thumbnailLongSide = 176

/** What a count says on its badge: "2×", or "aus" for a page or photo that is left out. */
const countText = (count: number) => (count > 0 ? `${count}×` : "aus")

/**
 * "Wie oft": one small picture per page of the PDF or per photo, in the file's order (see `FadingRow`), each with how
 * often it prints. A tap on the picture leaves it out ("aus") or brings it back once; − and + under it count it down
 * to "aus" or up to `maxCount`. A long PDF has no − and +, so a page brought back there prints as often as the others.
 * "Alle gleich" above sets every page or photo that prints to one count. The pictures show the pages and photos
 * upright, as they are in the file.
 */
export function Thumbnails(props: {
  source: PreviewSource
  /** Every page number of the PDF (from 1) or every photo index (from 0), in order. */
  refs: readonly number[]
  /** How often each of them prints, in the same order. */
  counts: readonly number[]
  /** Pictures that only switch on and off, without − and + of their own: a long PDF. */
  onOffOnly: boolean
  /** Black and white is chosen. */
  grey: boolean
  onCount: (ref: number, count: number) => void
  /** Sets every page or photo that prints to `count`. */
  onAll: (count: number) => void
}) {
  const pdf = () => props.source.kind === "pdf"
  const printed = () => props.counts.filter(count => count > 0)
  /** The count every printed page or photo has, or `undefined` when they differ or none prints. */
  const common = () => {
    const [first, ...rest] = printed()
    return first !== undefined && rest.every(count => count === first) ? first : undefined
  }
  /** "Alle gleich" − or +: from mixed counts the first tap brings every one up to the highest; then they move together. */
  function stepAll(by: -1 | 1) {
    const now = common()
    props.onAll(now === undefined ? Math.max(...printed()) : Math.min(maxCount, Math.max(1, now + by)))
  }
  const step = "size-10 shrink-0 cursor-pointer rounded-lg border border-gray-300 text-lg font-semibold disabled:cursor-default disabled:opacity-40"
  return (
    <section class="flex flex-col gap-2" aria-label="Wie oft">
      <div class="flex items-center justify-between gap-2">
        <h2 class="font-semibold">Wie oft</h2>
        <div class="flex items-center gap-1 text-sm">
          Alle gleich
          <button type="button" class={step} aria-label="Alle seltener" disabled={printed().length === 0 || common() === 1} onClick={() => stepAll(-1)}>−</button>
          <output class="w-10 text-center font-semibold" aria-label="Alle gleich">
            {printed().length === 0 ? "–" : common() === undefined ? "≠" : `${common()}×`}
          </output>
          <button type="button" class={step} aria-label="Alle öfter" disabled={printed().length === 0 || common() === maxCount} onClick={() => stepAll(1)}>+</button>
        </div>
      </div>
      <FadingRow role="group" label={pdf() ? "Seiten" : "Fotos"}>
        <For each={props.refs}>
          {(ref, index) => {
            const count = () => props.counts[index()] ?? 0
            const name = () => itemName(props.source.kind, ref)
            // a PDF's pages are drawn as they scroll into view: a long PDF would otherwise draw hundreds at once
            const [seen, setSeen] = createSignal(false)
            let card!: HTMLDivElement
            onSettled(() => {
              const watcher = new IntersectionObserver(entries => {
                if (!entries.some(entry => entry.isIntersecting)) return
                setSeen(true)
                watcher.disconnect()
              }, { rootMargin: "0px 200px" })
              watcher.observe(card)
              return () => watcher.disconnect()
            })
            return (
              <div
                ref={card}
                class={`relative flex shrink-0 flex-col overflow-hidden rounded-lg border-2 bg-white ${props.onOffOnly ? "w-[62px]" : "w-[84px]"} ${count() > 0 ? "border-brand" : "border-gray-200"}`}
              >
                <button
                  type="button"
                  aria-label={name()}
                  aria-pressed={count() > 0 ? "true" : "false"}
                  class="relative h-[88px] cursor-pointer"
                  onClick={() => props.onCount(ref, count() > 0 ? 0 : props.onOffOnly ? (common() ?? 1) : 1)}
                >
                  <div class="size-full" style={{ filter: props.grey ? "grayscale(1)" : "none", opacity: count() > 0 ? 1 : 0.35 }}>
                    <Show
                      when={props.source.kind === "photos" && props.source}
                      fallback={
                        <Show when={seen()}>
                          <PdfPage pdf={props.source.kind === "pdf" ? props.source.pdf : undefined} page={ref} longSide={thumbnailLongSide} fit="contain" />
                        </Show>
                      }
                    >
                      {photos => <img class="block size-full object-contain" src={photos().urls[ref]} alt="" loading="lazy" decoding="async" />}
                    </Show>
                  </div>
                  <span aria-hidden="true" class={`absolute right-0 bottom-0 rounded-tl-md px-1.5 text-xs font-semibold text-white ${count() > 0 ? "bg-brand" : "bg-gray-500"}`}>
                    {pdf() ? ref : ref + 1}
                  </span>
                </button>
                <output
                  aria-label={`Wie oft ${name()}`}
                  class="pointer-events-none absolute top-1 right-1 rounded-full bg-white/90 px-1.5 text-xs font-bold"
                >
                  {countText(count())}
                </output>
                <Show when={!props.onOffOnly}>
                  <div class="flex border-t border-gray-200">
                    <button
                      type="button"
                      class="h-10 flex-1 cursor-pointer border-r border-gray-200 text-lg disabled:cursor-default disabled:opacity-40"
                      aria-label={`${name()} seltener`}
                      disabled={count() === 0}
                      onClick={() => props.onCount(ref, count() - 1)}
                    >
                      −
                    </button>
                    <button
                      type="button"
                      class="h-10 flex-1 cursor-pointer text-lg disabled:cursor-default disabled:opacity-40"
                      aria-label={`${name()} öfter`}
                      disabled={count() === maxCount}
                      onClick={() => props.onCount(ref, count() + 1)}
                    >
                      +
                    </button>
                  </div>
                </Show>
              </div>
            )
          }}
        </For>
      </FadingRow>
    </section>
  )
}
