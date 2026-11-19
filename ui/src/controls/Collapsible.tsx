import type { JSX } from "@solidjs/web"
import { createSignal, createUniqueId, Show } from "solid-js"

/** A titled section that is closed at first. Tapping the title opens and closes it. */
export function Collapsible(props: { title: string; children: JSX.Element }) {
  const [open, setOpen] = createSignal(false)
  const contentId = createUniqueId()

  return (
    <div>
      <button
        type="button"
        class="flex cursor-pointer items-center gap-2 py-2 font-semibold text-brand"
        aria-expanded={open() ? "true" : "false"}
        aria-controls={contentId}
        onClick={() => setOpen(!open())}
      >
        <span aria-hidden="true">{open() ? "▾" : "▸"}</span>
        {props.title}
      </button>
      <Show when={open()}>
        <div id={contentId}>{props.children}</div>
      </Show>
    </div>
  )
}
