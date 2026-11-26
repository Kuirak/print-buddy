/**
 * An on/off switch as a chip: filled, with a tick in a white circle, when on; an outline with an empty circle
 * when off. Mixed, when only some pages or photos have it: an outline with the mixed dot.
 */
export function ToggleChip(props: {
  label: string
  state: "on" | "off" | "mixed"
  /** The chip was tapped: `on` is what it should stand at now. A tap on a mixed chip switches it on. */
  onChange: (on: boolean) => void
}) {
  const on = () => props.state === "on"
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.state === "mixed" ? "mixed" : on() ? "true" : "false"}
      // a screen reader may read a mixed switch as off, so the words say it too
      aria-description={props.state === "mixed" ? "bei einigen" : undefined}
      class={`chip ${on() ? "border-brand bg-brand text-white" : "border-gray-300 bg-white"}`}
      onClick={() => props.onChange(!on())}
    >
      <span aria-hidden="true" class={`chip-circle ${on() ? "border-white bg-white text-brand" : "border-gray-400"}`}>
        {on() ? (
          <svg viewBox="0 0 24 24" class="size-3" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
        ) : props.state === "mixed" ? <span class="chip-mixed-dot" /> : null}
      </span>
      <span class="chip-label">{props.label}</span>
    </button>
  )
}
