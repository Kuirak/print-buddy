import { createSignal, Show } from "solid-js"
import { copyReport, type ReportSubject } from "../report.ts"

/** "Bericht kopieren": puts the report about `subject` on the clipboard and says whether that worked. */
export function ReportButton(props: { subject: ReportSubject }) {
  const [outcome, setOutcome] = createSignal<string>()

  async function copy() {
    setOutcome(undefined)
    setOutcome(await copyReport(props.subject).then(() => "Kopiert", () => "Kopieren hat nicht geklappt"))
  }

  return (
    <div class="flex flex-col gap-1">
      <button type="button" class="btn-secondary" onClick={() => void copy()}>
        Bericht kopieren
      </button>
      <Show when={outcome()}>
        {said => <p role="status" class="text-center text-sm text-muted">{said()}</p>}
      </Show>
    </div>
  )
}
