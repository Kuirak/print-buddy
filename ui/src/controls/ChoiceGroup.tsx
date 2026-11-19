import { For } from "solid-js"

/** One of a few choices, all visible as buttons side by side. No dropdown. */
export function ChoiceGroup<T extends string | number>(props: {
  /** Names the group for screen readers, for example "Papier". */
  label: string
  choices: readonly { value: T; label: string }[]
  /** `undefined` when none of the choices applies: then none is marked. */
  value: T | undefined
  onChange: (value: T) => void
  /** Smaller buttons that stay in one row, for a group that shares its row with other controls. */
  compact?: boolean
}) {
  return (
    <div role="radiogroup" aria-label={props.label} class={props.compact ? "flex gap-1" : "flex flex-wrap justify-end gap-2"}>
      <For each={props.choices}>
        {choice => (
          <button
            type="button"
            role="radio"
            aria-checked={props.value === choice.value ? "true" : "false"}
            class={`cursor-pointer rounded-lg border font-semibold whitespace-nowrap ${props.compact ? "min-h-10 px-2 py-1.5 text-[13px]" : "min-h-11 px-3 py-2"} ${props.value === choice.value ? "border-brand bg-brand text-white" : "border-gray-300 bg-white"}`}
            onClick={() => props.onChange(choice.value)}
          >
            {choice.label}
          </button>
        )}
      </For>
    </div>
  )
}
