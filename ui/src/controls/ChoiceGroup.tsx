import { For } from "solid-js"

/** One of a few choices, all visible as chips with a radio circle, side by side. No dropdown. */
export function ChoiceGroup<T extends string | number>(props: {
  /** Names the group for screen readers, for example "Papier". */
  label: string
  choices: readonly { value: T; label: string }[]
  /** `undefined` when none of the choices applies: then none is marked as chosen. */
  value: T | undefined
  /**
   * The values some pages or photos have while they differ: each carries the mixed dot.
   * `value` is `undefined` then, so none is chosen.
   */
  inUse?: readonly T[]
  onChange: (value: T) => void
  /** For a group that shares its row with other controls: the chips start at the left and stand closer together. */
  compact?: boolean
}) {
  return (
    <div role="radiogroup" aria-label={props.label} class={`flex flex-wrap ${props.compact ? "gap-1.5" : "justify-end gap-2"}`}>
      <For each={props.choices}>
        {choice => {
          const chosen = () => props.value === choice.value
          const inUse = () => props.inUse?.includes(choice.value) ?? false
          return (
            <button
              type="button"
              role="radio"
              aria-checked={chosen() ? "true" : "false"}
              // a radio can't be "mixed" for a screen reader, so the words say it
              aria-description={inUse() ? "bei einigen" : undefined}
              class={`chip bg-white ${chosen() ? "border-brand" : "border-gray-300"}`}
              onClick={() => props.onChange(choice.value)}
            >
              <span class={`chip-circle ${chosen() ? "border-brand" : "border-gray-400"}`}>
                {chosen() ? <span class="size-2.5 rounded-full bg-brand" /> : inUse() ? <span class="chip-mixed-dot" /> : null}
              </span>
              {choice.label}
            </button>
          )
        }}
      </For>
    </div>
  )
}
