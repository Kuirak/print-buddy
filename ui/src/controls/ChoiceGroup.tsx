import { For } from "solid-js"

/** One of a few choices, all visible as buttons side by side. No dropdown. */
export function ChoiceGroup<T extends string>(props: {
  /** Names the group for screen readers, for example "Papier". */
  label: string
  choices: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={props.label} class="flex flex-wrap justify-end gap-2">
      <For each={props.choices}>
        {choice => (
          <button
            type="button"
            role="radio"
            aria-checked={props.value === choice.value ? "true" : "false"}
            class={`min-h-11 cursor-pointer rounded-lg border px-3 py-2 font-semibold ${props.value === choice.value ? "border-brand bg-brand text-white" : "border-gray-300 bg-white"}`}
            onClick={() => props.onChange(choice.value)}
          >
            {choice.label}
          </button>
        )}
      </For>
    </div>
  )
}
