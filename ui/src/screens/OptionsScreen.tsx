import { createStore, snapshot, untrack } from "solid-js"
import type { JSX } from "@solidjs/web"
import { maxCopies, type PrintOptions } from "../../../shared/print-options.ts"
import { ChoiceGroup } from "../controls/ChoiceGroup.tsx"
import { PresetActions } from "../controls/PresetActions.tsx"
import { PresetChips } from "../controls/PresetChips.tsx"
import { Stepper } from "../controls/Stepper.tsx"
import { createPresets, type FileKind, type Preset } from "../presets.ts"

const colors = [
  { value: "color", label: "Farbe" },
  { value: "mono", label: "S/W" },
] as const

const papers = [
  { value: "A4", label: "A4" },
  { value: "A5", label: "A5" },
  { value: "EnvDL", label: "Umschlag DL" },
  { value: "EnvC5", label: "Umschlag C5" },
] as const

const qualities = [
  { value: "normal", label: "Normal" },
  { value: "draft", label: "Toner sparen" },
] as const

function Row(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex items-center justify-between gap-4 border-b border-gray-200 py-2">
      <span class="shrink-0">{props.label}</span>
      {props.children}
    </div>
  )
}

export function OptionsScreen(props: { fileName: string; kind: FileKind; onPrint: (options: PrintOptions) => void }) {
  const presets = createPresets(untrack(() => props.kind))
  // a new file starts from the starred Preset, never from the settings of the job before
  const [options, setOptions] = createStore<PrintOptions>({ ...structuredClone(presets.starred().values), rotation: 0, selection: [] })

  /** Sets what the Preset stores. Page selection and rotation stay as they are. */
  function apply(preset: Preset) {
    presets.pick(preset)
    setOptions(o => { Object.assign(o, structuredClone(preset.values)) })
  }

  return (
    <main class="flex min-h-dvh flex-col gap-4 p-4">
      <h1 class="truncate font-bold">{props.fileName}</h1>
      <PresetChips presets={presets} options={options} onPick={apply} />
      <section>
        <Row label="Kopien">
          <Stepper
            label="Kopien"
            decreaseLabel="Weniger Kopien"
            increaseLabel="Mehr Kopien"
            value={options.copies}
            min={1}
            max={maxCopies}
            onChange={copies => setOptions(o => { o.copies = copies })}
          />
        </Row>
        <Row label="Farbe">
          <ChoiceGroup label="Farbe" choices={colors} value={options.color} onChange={color => setOptions(o => { o.color = color })} />
        </Row>
        <Row label="Papier">
          <ChoiceGroup label="Papier" choices={papers} value={options.paper} onChange={paper => setOptions(o => { o.paper = paper })} />
        </Row>
        <Row label="Qualität">
          <ChoiceGroup label="Qualität" choices={qualities} value={options.quality} onChange={quality => setOptions(o => { o.quality = quality })} />
        </Row>
      </section>
      <PresetActions presets={presets} options={options} onPick={apply} />
      <div class="sticky bottom-0 mt-auto bg-white py-3">
        <button type="button" class="btn-primary" onClick={() => props.onPrint(snapshot(options))}>
          Drucken
        </button>
      </div>
    </main>
  )
}
