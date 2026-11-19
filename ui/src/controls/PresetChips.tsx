import { For } from "solid-js"
import type { Preset, Presets, PresetValues } from "../presets.ts"

/**
 * One chip per Preset in a row that scrolls sideways. The chip of the Preset the Print Options match
 * is marked, the starred one carries a star, and the last chip stands for Print Options that match none.
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
    `min-h-11 shrink-0 cursor-pointer rounded-full border px-4 py-2 font-semibold ${on ? "border-brand bg-brand text-white" : "border-gray-300 bg-white"}`
  return (
    <div role="radiogroup" aria-label="Voreinstellung" class="flex gap-2 overflow-x-auto">
      <For each={props.presets.list()}>
        {preset => (
          <button
            type="button"
            role="radio"
            aria-checked={active()?.id === preset.id ? "true" : "false"}
            class={chip(active()?.id === preset.id)}
            onClick={() => props.onPick(preset)}
          >
            {props.presets.starred().id === preset.id ? "★ " : ""}{preset.name}
          </button>
        )}
      </For>
      <button type="button" role="radio" aria-checked={active() ? "false" : "true"} class={chip(!active())} onClick={props.onOwn}>
        {active() ? "Eigene …" : "✎ Eigene"}
      </button>
    </div>
  )
}
