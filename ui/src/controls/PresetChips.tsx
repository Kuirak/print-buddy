import { For } from "solid-js"
import type { Preset, Presets, PresetValues } from "../presets.ts"
import { FadingRow } from "./FadingRow.tsx"
import { PencilIcon, StarIcon } from "./Icons.tsx"

/**
 * One chip per Preset in a row that scrolls sideways (see `FadingRow`). The chip of the Preset the Print Options
 * match is marked, and scrolled into view when the row appears. The starred one carries a star, and the last chip
 * stands for Print Options that match none.
 */
export function PresetChips(props: {
  presets: Presets
  options: PresetValues
  onPick: (preset: Preset) => void
  /** The last chip was tapped: it stands for Print Options no Preset has, so the detailed controls should open. */
  onOwn: () => void
}) {
  const active = () => props.presets.matching(props.options)
  const chip = (on: boolean) =>
    `inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-4 py-1.5 font-semibold whitespace-nowrap ${on ? "border-brand bg-brand text-white" : "border-gray-300 bg-white"}`

  return (
    <FadingRow role="radiogroup" label="Voreinstellung">
      <For each={props.presets.list()}>
        {preset => (
          <button
            type="button"
            role="radio"
            aria-checked={active()?.id === preset.id ? "true" : "false"}
            // the star is a picture, so the words say which Preset a new file starts from
            aria-description={props.presets.starred().id === preset.id ? "Standard" : undefined}
            class={chip(active()?.id === preset.id)}
            onClick={() => props.onPick(preset)}
          >
            {props.presets.starred().id === preset.id ? <StarIcon class="size-4 shrink-0" /> : null}{preset.name}
          </button>
        )}
      </For>
      <button type="button" role="radio" aria-checked={active() ? "false" : "true"} class={chip(!active())} onClick={props.onOwn}>
        {active() ? "Eigene …" : <><PencilIcon class="size-4 shrink-0" />Eigene</>}
      </button>
    </FadingRow>
  )
}
