import { createSignal, onSettled, Show } from "solid-js"

/** How long the note stays before it goes by itself. */
const visibleMs = 6_000

/**
 * A sticky note over the top of the screen that says something about the app itself, not about the Print Job:
 * that the page has just been reloaded into a new version (`done`, mint), or that a new version waits for the
 * job to end (`info`, yellow). It goes by itself after a few seconds, and taps pass through it to whatever lies
 * under it, such as "Zurück".
 */
export function UpdateNote(props: { text: string; tone: "done" | "info" }) {
  const [shown, setShown] = createSignal(true)
  onSettled(() => {
    const timer = setTimeout(() => setShown(false), visibleMs)
    return () => clearTimeout(timer)
  })
  return (
    <Show when={shown()}>
      <p
        role="status"
        aria-label="Hinweis zur App"
        class={`note scribble pointer-events-none fixed inset-x-0 top-[max(0.5rem,env(safe-area-inset-top))] z-20 mx-auto w-fit max-w-[calc(100%-1rem)] -rotate-1 shadow-md ${props.tone === "done" ? "bg-note-mint" : "bg-note-yellow"}`}
      >
        {props.text}
      </p>
    </Show>
  )
}
