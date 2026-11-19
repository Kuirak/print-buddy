import { Show } from "solid-js"
import type { PrintSizeMode } from "../../../shared/print-options.ts"
import { ChoiceGroup } from "./ChoiceGroup.tsx"
import { Stepper } from "./Stepper.tsx"

const shortcuts = [
  { value: "fit", label: "Einpassen" },
  { value: "fill", label: "Füllen" },
  { value: "100", label: "100 %" },
] as const

/** The smallest and the largest percentage the − and + buttons reach. */
const minPercent = 10
const maxPercent = 400

/** The Print size: three shortcuts, and − / + that move the percentage in steps of 5. */
export function PrintSize(props: {
  value: PrintSizeMode
  /**
   * The percentage the content is printed at right now, rounded. At Einpassen and Füllen it comes from
   * the layout module. `undefined` while that is not known: then the − / + buttons are left out.
   */
  percent: number | undefined
  onChange: (value: PrintSizeMode) => void
}) {
  return (
    <div class="flex flex-wrap items-center justify-between gap-2">
      <ChoiceGroup
        label="Druckgröße"
        choices={shortcuts}
        value={props.value.kind !== "percent" ? props.value.kind : props.value.value === 100 ? "100" : undefined}
        onChange={picked => props.onChange(picked === "100" ? { kind: "percent", value: 100 } : { kind: picked })}
      />
      <Show when={props.percent}>
        {percent => (
          <Stepper
            label="Druckgröße in Prozent"
            decreaseLabel="Kleiner drucken"
            increaseLabel="Größer drucken"
            value={percent()}
            min={minPercent}
            max={maxPercent}
            step={5}
            unit=" %"
            onChange={value => props.onChange({ kind: "percent", value })}
          />
        )}
      </Show>
    </div>
  )
}
