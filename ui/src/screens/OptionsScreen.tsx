import { createStore, snapshot } from "solid-js"
import type { JSX } from "@solidjs/web"
import { maxCopies, type PrintOptions } from "../../../shared/print-options.ts"
import { ChoiceGroup } from "../controls/ChoiceGroup.tsx"
import { Stepper } from "../controls/Stepper.tsx"

/** What a new file starts with. */
const initialOptions: PrintOptions = {
  copies: 1,
  color: "mono",
  paper: "A4",
  quality: "normal",
  printSize: { kind: "fit" },
  position: "center",
  pagesPerSheet: 1,
  rotation: 0,
  selection: [],
}

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

export function OptionsScreen(props: { fileName: string; onPrint: (options: PrintOptions) => void }) {
  const [options, setOptions] = createStore<PrintOptions>(structuredClone(initialOptions))

  return (
    <main class="flex min-h-dvh flex-col gap-4 p-4">
      <h1 class="truncate font-bold">{props.fileName}</h1>
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
      <div class="sticky bottom-0 mt-auto bg-white py-3">
        <button type="button" class="btn-primary" onClick={() => props.onPrint(snapshot(options))}>
          Drucken
        </button>
      </div>
    </main>
  )
}
