import type { Refusal } from "../../../shared/api.ts"
import { FilePicker } from "../controls/FilePicker.tsx"
import { ReportButton } from "../controls/ReportButton.tsx"
import { ThumbScreen } from "../controls/ThumbScreen.tsx"

function message(refusal: Refusal): string {
  switch (refusal.refusal) {
    case "unsupported-type":
      return "Diese Datei kann Print Buddy nicht drucken. Möglich sind PDF, JPG und PNG."
    case "too-large":
      return `Die Datei ist zu groß (höchstens ${refusal.limitMb} MB).`
    case "too-many-photos":
      return "Höchstens 20 Fotos auf einmal"
    case "one-pdf-only":
      return "Bitte jeweils nur eine Datei teilen"
    case "mixed-types":
      return "Bitte PDF und Fotos getrennt teilen"
  }
}

/** Shown when the server refused a picked file. Nothing prints; the person can pick again. `file` is the refused one. */
export function RefusalScreen(props: { refusal: Refusal; file: File; onPick: (files: File[]) => void }) {
  return (
    <ThumbScreen actions={<FilePicker onPick={props.onPick} />}>
      <h1 class="text-xl font-bold">{message(props.refusal)}</h1>
      <p class="note scribble -rotate-1 bg-note-yellow">Es wurde nichts gedruckt. Wähle die Dateien neu aus.</p>
      <ReportButton subject={{ happened: `Die Datei wurde abgelehnt: ${message(props.refusal)}`, files: () => [props.file] }} />
    </ThumbScreen>
  )
}
