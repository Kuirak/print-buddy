import type { JSX } from "@solidjs/web"

/**
 * A screen with its buttons at the bottom, within reach of the thumb when the phone is held in one hand, as on Start.
 * The last of `actions` is nearest the thumb: put the main one there. Not sticky: when the screen is too short the
 * page scrolls, and nothing lies over the content.
 */
export function ThumbScreen(props: {
  children: JSX.Element
  actions: JSX.Element
  /** The screen sits behind a dialog. */
  inert?: boolean
  /** The screen waits for the server. */
  busy?: boolean
}) {
  return (
    <main
      class="flex min-h-dvh flex-col gap-6 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      inert={props.inert}
      aria-busy={props.busy ? "true" : undefined}
    >
      <div class="flex flex-1 flex-col gap-3">{props.children}</div>
      <div class="flex flex-col gap-2">{props.actions}</div>
    </main>
  )
}
