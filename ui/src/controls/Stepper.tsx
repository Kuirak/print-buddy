/** A whole number between `min` and `max`, changed one step at a time with − and +. */
export function Stepper(props: {
  /** Names the value for screen readers, for example "Kopien". */
  label: string
  /** Names the − button, for example "Weniger Kopien". */
  decreaseLabel: string
  /** Names the + button, for example "Mehr Kopien". */
  increaseLabel: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  const button = "size-11 cursor-pointer rounded-lg border border-gray-300 text-xl font-semibold disabled:cursor-default disabled:opacity-40"
  return (
    <div class="flex items-center gap-3">
      <button
        type="button"
        class={button}
        aria-label={props.decreaseLabel}
        disabled={props.value <= props.min}
        onClick={() => props.onChange(Math.max(props.min, props.value - 1))}
      >
        −
      </button>
      <output class="min-w-8 text-center font-bold" aria-label={props.label}>{props.value}</output>
      <button
        type="button"
        class={button}
        aria-label={props.increaseLabel}
        disabled={props.value >= props.max}
        onClick={() => props.onChange(Math.min(props.max, props.value + 1))}
      >
        +
      </button>
    </div>
  )
}
