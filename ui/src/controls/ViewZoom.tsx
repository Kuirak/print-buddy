/** The zoom steps of the preview: 1 shows the whole sheet. */
const steps = [1, 1.5, 2, 3]

/** "Ansicht": how far the preview is zoomed in on the screen. It changes nothing about the printout. */
export function ViewZoom(props: { value: number; onChange: (value: number) => void }) {
  const button = "size-10 cursor-pointer rounded-lg border border-gray-300 text-xl font-semibold disabled:cursor-default disabled:opacity-40"
  return (
    <div class="flex items-center gap-2">
      <button
        type="button"
        class={button}
        aria-label="Ansicht verkleinern"
        disabled={props.value <= steps[0]!}
        onClick={() => props.onChange(steps[steps.indexOf(props.value) - 1]!)}
      >
        −
      </button>
      <span class="text-muted whitespace-nowrap">Ansicht {Math.round(props.value * 100)}%</span>
      <button
        type="button"
        class={button}
        aria-label="Ansicht vergrößern"
        disabled={props.value >= steps.at(-1)!}
        onClick={() => props.onChange(steps[steps.indexOf(props.value) + 1]!)}
      >
        +
      </button>
    </div>
  )
}
