import { ReportButton } from "../controls/ReportButton.tsx"
import { ThumbScreen } from "../controls/ThumbScreen.tsx"
import type { ReportSubject } from "../report.ts"

/**
 * Shown when a Print Job could not be sent. The app still holds the file and the Print Options, so the
 * same job can be sent again. "Schließen" gives the job up.
 */
export function SendFailedScreen(props: { report: ReportSubject; onRetry: () => void; onClose: () => void }) {
  return (
    <ThumbScreen
      actions={
        <>
          <button type="button" class="btn-secondary" onClick={() => props.onClose()}>
            Schließen
          </button>
          <button type="button" class="btn-primary" onClick={() => props.onRetry()}>
            Erneut versuchen
          </button>
        </>
      }
    >
      <h1 class="text-xl font-bold">Drucken hat nicht geklappt</h1>
      <ReportButton subject={props.report} />
    </ThumbScreen>
  )
}
