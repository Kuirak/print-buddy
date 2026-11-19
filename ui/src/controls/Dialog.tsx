import type { JSX } from "@solidjs/web"
import { onSettled } from "solid-js"

/**
 * A panel over a dimmed screen: in the middle, or as a sheet at the bottom edge. A tap beside it and
 * Escape both ask to close it. The screen behind has to be made `inert` by whoever opens it.
 */
export function Dialog(props: {
  /** Names the dialog for screen readers. */
  label: string
  at: "center" | "bottom"
  onClose: () => void
  children: JSX.Element
}) {
  let panel!: HTMLDivElement
  // the screen behind is inert, so the keyboard and screen readers have to start inside
  onSettled(() => panel.focus())
  return (
    <div
      class={`fixed inset-0 z-10 flex justify-center bg-black/40 ${props.at === "center" ? "items-center p-4" : "items-end"}`}
      onClick={event => { if (event.target === event.currentTarget) props.onClose() }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={props.label}
        tabindex="-1"
        class={`flex max-h-[90dvh] w-full max-w-[480px] flex-col gap-3 overflow-y-auto bg-white p-4 shadow-xl outline-none ${props.at === "center" ? "rounded-2xl" : "rounded-t-2xl"}`}
        onKeyDown={event => { if (event.key === "Escape") props.onClose() }}
      >
        {props.children}
      </div>
    </div>
  )
}
