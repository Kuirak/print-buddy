import { createEffect, createSignal, For, onSettled, Show } from "solid-js"
import type { Preset, Presets, PresetValues } from "../presets.ts"

/**
 * One chip per Preset in a row that scrolls sideways, without a scrollbar: an edge with more chips beyond
 * it fades out instead. The chip of the Preset the Print Options match is marked, and scrolled into view
 * when the row appears. The starred one carries a star, and the last chip stands for Print Options that
 * match none.
 */
export function PresetChips(props: {
  presets: Presets
  options: PresetValues
  onPick: (preset: Preset) => void
  /** The last chip was tapped: it stands for Print Options no Preset has, so the detailed controls should open. */
  onOwn: () => void
}) {
  const active = () => props.presets.matching(props.options)
  const chip = (on: boolean) =>
    `min-h-10 shrink-0 cursor-pointer rounded-full border px-4 py-1.5 font-semibold whitespace-nowrap ${on ? "border-brand bg-brand text-white" : "border-gray-300 bg-white"}`

  let row!: HTMLDivElement
  /** Whether chips lie beyond the left and the right edge. */
  const [more, setMore] = createSignal({ left: false, right: false })
  function measure() {
    // a pixel of slack: the browser may round the scroll position
    setMore({ left: row.scrollLeft > 1, right: row.scrollLeft + row.clientWidth < row.scrollWidth - 1 })
  }
  // chips come and go when an own Preset is saved or deleted, and the marked one can get longer ("✎ Eigene")
  createEffect(() => [props.presets.list().length, active()], () => measure())
  onSettled(() => {
    const marked = row.querySelector<HTMLElement>('[aria-checked="true"]')
    // the row is the chips' offset parent, so this centres the marked chip; the browser keeps it within the row
    if (marked) row.scrollLeft = marked.offsetLeft - (row.clientWidth - marked.offsetWidth) / 2
    measure()
    const resized = new ResizeObserver(measure)
    resized.observe(row)
    return () => resized.disconnect()
  })

  const fade = "pointer-events-none absolute inset-y-0 w-10 from-white to-transparent"
  return (
    <div class="relative">
      <div
        ref={row}
        role="radiogroup"
        aria-label="Voreinstellung"
        class="relative flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={measure}
      >
        <For each={props.presets.list()}>
          {preset => (
            <button
              type="button"
              role="radio"
              aria-checked={active()?.id === preset.id ? "true" : "false"}
              class={chip(active()?.id === preset.id)}
              onClick={() => props.onPick(preset)}
            >
              {props.presets.starred().id === preset.id ? "★ " : ""}{preset.name}
            </button>
          )}
        </For>
        <button type="button" role="radio" aria-checked={active() ? "false" : "true"} class={chip(!active())} onClick={props.onOwn}>
          {active() ? "Eigene …" : "✎ Eigene"}
        </button>
      </div>
      <Show when={more().left}>
        <div aria-hidden="true" class={`${fade} left-0 bg-linear-to-r`} />
      </Show>
      <Show when={more().right}>
        <div aria-hidden="true" class={`${fade} right-0 bg-linear-to-l`} />
      </Show>
    </div>
  )
}
