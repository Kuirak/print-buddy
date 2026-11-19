import { For } from "solid-js"
import type { Position } from "../../../shared/print-options.ts"
import { positionNames } from "../job-text.ts"

/** Row by row, as they sit on the sheet. */
const spots = (Object.keys(positionNames) as Position[]).map(value => ({ value, label: positionNames[value] }))

/** The Position: nine spots laid out like the sheet, with the chosen one filled. */
export function PositionGrid(props: { value: Position; onChange: (value: Position) => void }) {
  return (
    <div role="radiogroup" aria-label="Position" class="grid grid-cols-3 gap-1">
      <For each={spots}>
        {spot => (
          <button
            type="button"
            role="radio"
            aria-label={spot.label}
            aria-checked={props.value === spot.value ? "true" : "false"}
            class={`grid size-8 cursor-pointer place-items-center rounded-md border ${props.value === spot.value ? "border-brand bg-brand" : "border-gray-300 bg-white"}`}
            onClick={() => props.onChange(spot.value)}
          >
            <span class={`size-2 rounded-full ${props.value === spot.value ? "bg-white" : "bg-gray-400"}`} />
          </button>
        )}
      </For>
    </div>
  )
}
