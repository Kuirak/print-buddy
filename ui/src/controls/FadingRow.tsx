import type { JSX } from "@solidjs/web"
import { createSignal, onSettled, Show } from "solid-js"

/**
 * A row that scrolls sideways without a scrollbar: an edge with more beyond it fades out instead. A mouse wheel
 * scrolls it sideways while it can move. The marked entry (`aria-checked="true"`) is scrolled into view when the
 * row appears.
 */
export function FadingRow(props: {
  /** Names the row for screen readers. */
  label: string
  role: "radiogroup" | "group"
  children: JSX.Element
}) {
  let row!: HTMLDivElement
  let content!: HTMLDivElement
  /** Whether entries lie beyond the left and the right edge. */
  const [more, setMore] = createSignal({ left: false, right: false })
  function measure() {
    // a pixel of slack: the browser may round the scroll position
    setMore({ left: row.scrollLeft > 1, right: row.scrollLeft + row.clientWidth < row.scrollWidth - 1 })
  }
  onSettled(() => {
    const marked = row.querySelector<HTMLElement>('[aria-checked="true"]')
    // the row is the entries' offset parent, so this centres the marked one; the browser keeps it within the row
    if (marked) row.scrollLeft = marked.offsetLeft - (row.clientWidth - marked.offsetWidth) / 2
    measure()
    // entries come and go, and get longer ("✎ Eigene"): the content's size changes, not the row's
    const resized = new ResizeObserver(measure)
    resized.observe(row)
    resized.observe(content)
    // an upright wheel scrolls the row sideways while it can move; at its ends the page scrolls on.
    // A sideways wheel or a trackpad already scrolls the row by itself.
    function wheel(event: WheelEvent) {
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
      const before = row.scrollLeft
      row.scrollLeft += event.deltaY
      if (row.scrollLeft !== before) event.preventDefault()
    }
    row.addEventListener("wheel", wheel, { passive: false })
    return () => {
      resized.disconnect()
      row.removeEventListener("wheel", wheel)
    }
  })

  const fade = "pointer-events-none absolute inset-y-0 w-10 from-white to-transparent"
  return (
    <div class="relative">
      <div ref={row} class="relative overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" onScroll={measure}>
        <div ref={content} role={props.role} aria-label={props.label} class="flex w-max gap-2">
          {props.children}
        </div>
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
