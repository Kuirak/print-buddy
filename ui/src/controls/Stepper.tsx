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
  /** How far one tap moves the value. 1 if left out. */
  step?: number
  /** Shown after the value, for example " %". */
  unit?: string
  onChange: (value: number) => void
  /** Smaller buttons, for a stepper that shares its row with other controls. */
  compact?: boolean
}) {
  const button = `${props.compact ? "size-10" : "size-11"} cursor-pointer rounded-lg border border-gray-300 text-xl font-semibold disabled:cursor-default disabled:opacity-40`
  return (
    <div class={`flex items-center ${props.compact ? "gap-2" : "gap-3"}`}>
      <button
        type="button"
        class={button}
        aria-label={props.decreaseLabel}
        disabled={props.value <= props.min}
        onClick={() => props.onChange(Math.max(props.min, props.value - (props.step ?? 1)))}
      >
        −
      </button>
      <output class={`${props.compact ? "min-w-12" : "min-w-8"} text-center font-bold whitespace-nowrap`} aria-label={props.label}>{props.value}{props.unit}</output>
      <button
        type="button"
        class={button}
        aria-label={props.increaseLabel}
        disabled={props.value >= props.max}
        onClick={() => props.onChange(Math.min(props.max, props.value + (props.step ?? 1)))}
      >
        +
      </button>
    </div>
  )
}
