import { Show } from "solid-js"
import { ApiFailure } from "../api.ts"
import { ReportButton } from "../controls/ReportButton.tsx"
import { ThumbScreen } from "../controls/ThumbScreen.tsx"
import type { ReportSubject } from "../report.ts"

/**
 * What went wrong, in the person's words, and whether sending the same again can help. `retry: false` when the
 * server refused these Print Options: the same request would fail the same way, so only changing them helps.
 */
function failureReason(error: unknown): { text: string; retry: boolean } {
  if (!(error instanceof ApiFailure)) return { text: "Print Buddy war nicht erreichbar. Ist das Handy online?", retry: true }
  const body = error.body
  const code = typeof body === "object" && body !== null && "error" in body ? body.error : undefined
  switch (code) {
    case "invalid-options":
      return { text: "Diese Einstellungen passen nicht zu der Datei. Ändere sie und drucke noch einmal.", retry: false }
    case "render-failed":
      return { text: "Die Datei ließ sich nicht für den Drucker aufbereiten.", retry: true }
    case "cups-unreachable":
      return { text: "Der Druckdienst auf Home Assistant antwortet nicht. Läuft das CUPS-Add-on?", retry: true }
    case "cups-rejected":
      return { text: "Der Drucker hat den Auftrag abgelehnt. Ist er an und hat er Papier?", retry: true }
    case "not-found":
    case "empty-draft":
      return { text: "Die Datei war auf dem Server nicht mehr da. „Erneut versuchen“ schickt sie noch einmal.", retry: true }
    default:
      return { text: "Auf dem Server ist etwas schiefgegangen.", retry: true }
  }
}

/**
 * Shown when a Print Job could not be sent. The app still holds the file and the Print Options, so the
 * same job can be sent again, or, with `onEdit`, opened on the options screen with them to change them.
 * "Schließen" gives the job up.
 */
export function SendFailedScreen(props: { error: unknown; report: ReportSubject; onRetry: () => void; onEdit?: () => void; onClose: () => void }) {
  const reason = () => failureReason(props.error)
  return (
    <ThumbScreen
      actions={
        <>
          <button type="button" class="btn-secondary" onClick={() => props.onClose()}>
            Schließen
          </button>
          <Show when={props.onEdit && reason().retry}>
            <button type="button" class="btn-secondary" onClick={() => props.onEdit!()}>
              Einstellungen ändern
            </button>
          </Show>
          <Show
            when={reason().retry}
            fallback={
              <button type="button" class="btn-primary" onClick={() => (props.onEdit ?? props.onRetry)()}>
                Einstellungen ändern
              </button>
            }
          >
            <button type="button" class="btn-primary" onClick={() => props.onRetry()}>
              Erneut versuchen
            </button>
          </Show>
        </>
      }
    >
      <h1 class="text-xl font-bold">Drucken hat nicht geklappt</h1>
      <p>{reason().text}</p>
      <ReportButton subject={props.report} />
    </ThumbScreen>
  )
}
