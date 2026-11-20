import { Show } from "solid-js"
import type { PrintSizeMode } from "../../../shared/print-options.ts"
import { sizeNames } from "../job-text.ts"
import { ChoiceGroup } from "./ChoiceGroup.tsx"
import { Stepper } from "./Stepper.tsx"

/** The shortcuts of the Print size: Einpassen, Füllen, and 100 %. */
export type SizeChoice = "fit" | "fill" | "100"

const labels: Record<SizeChoice, string> = { ...sizeNames, "100": "100 %" }

/** Which shortcut a Print size is, if any: a percentage other than 100 is none of them. */
export const asSizeChoice = (size: PrintSizeMode): SizeChoice | undefined =>
  size.kind === "percent" ? (size.value === 100 ? "100" : undefined) : size.kind

/** The smallest and the largest percentage the − and + buttons reach. */
const minPercent = 10
const maxPercent = 400

/**
 * "Größe für alle": the Print size of every page or photo, as shortcuts, and for PDFs − / + that move the percentage
 * in steps of 5. While pages or photos have sizes of their own that differ, none is chosen and every size in use
 * carries the mixed dot.
 */
export function PrintSize(props: {
  value: PrintSizeMode
  /** The shortcuts on offer, in order. */
  choices: readonly SizeChoice[]
  /** The − / + percentage steps are on offer. */
  steps: boolean
  /** The sizes in use while they differ; `undefined` while every page or photo has the same. */
  mixed: readonly SizeChoice[] | undefined
  /**
   * The percentage the content is printed at right now, rounded. At Einpassen and Füllen it comes from
   * the layout module. `undefined` while that is not known: then the − / + buttons are left out.
   */
  percent: number | undefined
  onChange: (value: PrintSizeMode) => void
}) {
  return (
    <div class="flex flex-col items-start gap-2">
      <ChoiceGroup
        label="Größe für alle"
        choices={props.choices.map(value => ({ value, label: labels[value] }))}
        value={props.mixed ? undefined : asSizeChoice(props.value)}
        inUse={props.mixed}
        onChange={picked => props.onChange(picked === "100" ? { kind: "percent", value: 100 } : { kind: picked })}
        compact
      />
      <Show when={props.steps && props.percent}>
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
            compact
          />
        )}
      </Show>
    </div>
  )
}
