import type { JSX } from "@solidjs/web"
import { Show } from "solid-js"
import { maxCopies, type PrintOptions } from "../../../shared/print-options.ts"
import { paperNames, qualityNames } from "../job-text.ts"
import type { Preset, Presets } from "../presets.ts"
import { ChoiceGroup } from "./ChoiceGroup.tsx"
import { Dialog } from "./Dialog.tsx"
import { PresetActions } from "./PresetActions.tsx"
import { Stepper } from "./Stepper.tsx"

const colors = [
  { value: "color", label: "Farbe" },
  { value: "mono", label: "S/W" },
] as const

const papers = (["A4", "A5", "EnvDL", "EnvC5"] as const).map(value => ({ value, label: paperNames[value] }))

const qualities = (["normal", "draft"] as const).map(value => ({ value, label: qualityNames[value] }))

const perSheet = [
  { value: 1, label: "1" },
  { value: 2, label: "2" },
] as const

function Row(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex items-center justify-between gap-4 border-b border-gray-200 py-2">
      <span class="shrink-0">{props.label}</span>
      {props.children}
    </div>
  )
}

/**
 * The detailed controls, as a sheet at the bottom edge: copies, colour, paper, quality, pages per sheet
 * and the Preset actions. Every change applies at once, so the preview behind follows; there is nothing to undo.
 */
export function OptionsDrawer(props: {
  options: PrintOptions
  /** Two pages per sheet are for PDFs only. */
  kind: "pdf" | "photos"
  presets: Presets
  /** Changes one or more of the Print Options. */
  onChange: (changes: Partial<PrintOptions>) => void
  onPickPreset: (preset: Preset) => void
  onClose: () => void
}) {
  return (
    <Dialog label="Einstellungen" at="bottom" onClose={props.onClose}>
      <section>
        <Row label="Kopien">
          <Stepper
            label="Kopien"
            decreaseLabel="Weniger Kopien"
            increaseLabel="Mehr Kopien"
            value={props.options.copies}
            min={1}
            max={maxCopies}
            onChange={copies => props.onChange({ copies })}
          />
        </Row>
        <Row label="Farbe">
          <ChoiceGroup label="Farbe" choices={colors} value={props.options.color} onChange={color => props.onChange({ color })} />
        </Row>
        <Row label="Papier">
          <ChoiceGroup label="Papier" choices={papers} value={props.options.paper} onChange={paper => props.onChange({ paper })} />
        </Row>
        <Row label="Qualität">
          <ChoiceGroup label="Qualität" choices={qualities} value={props.options.quality} onChange={quality => props.onChange({ quality })} />
        </Row>
        <Show when={props.kind === "pdf"}>
          <Row label="Seiten pro Blatt">
            <ChoiceGroup
              label="Seiten pro Blatt"
              choices={perSheet}
              value={props.options.layout.kind === "grid" ? props.options.layout.perSheet : undefined}
              onChange={perSheet => props.onChange({ layout: { kind: "grid", perSheet } })}
            />
          </Row>
        </Show>
      </section>
      <PresetActions presets={props.presets} options={props.options} onPick={props.onPickPreset} />
      <button type="button" class="btn-primary" onClick={props.onClose}>Fertig</button>
    </Dialog>
  )
}
