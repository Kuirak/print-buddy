import { createEffect, createSignal, Show } from "solid-js"
import type { SubmitProgress } from "../../../shared/api.ts"
import { failedWith, readSubmitProgress, stopSubmit } from "../api.ts"
import { ThumbScreen } from "../controls/ThumbScreen.tsx"

const pollEveryMs = 500

/**
 * Shown from the moment printing starts until the submit answers: while the phone's copy is uploaded
 * ("Nochmal drucken", "Erneut versuchen"), while the server prepares the Print Job, and while it sends it to CUPS.
 * `uploading`: how far the upload has got, 0 to 1, until `draftId` is there. With `draftId` the submit of
 * that draft runs, and the screen asks the server how far it has got.
 * Abbrechen calls `onStopUpload` during the upload, and stops the submit while it prepares; the submit then
 * answers 409 `stopped` to whoever sent it.
 */
export function SendingScreen(props: { uploading?: number; draftId?: string; onStopUpload: () => void }) {
  /** The server's last answer; nothing before the first one, and after a read that failed. */
  const [progress, setProgress] = createSignal<SubmitProgress>()
  /** Abbrechen was tapped and the server hasn't answered yet. */
  const [stopping, setStopping] = createSignal(false)
  const sending = () => progress()?.phase === "sending"
  const uploading = () => props.draftId === undefined ? props.uploading : undefined
  const sheets = () => {
    const now = progress()
    return now?.phase === "preparing" && now.sheets > 1 ? now : undefined
  }

  createEffect(() => props.draftId, draftId => {
    if (draftId === undefined) return
    let left = false
    let nextPoll: ReturnType<typeof setTimeout> | undefined
    async function poll(draft: string) {
      const latest = await readSubmitProgress(draft).catch(() => undefined)
      if (left) return
      // sending can't turn back into preparing, so a read that fails then changes nothing
      setProgress(now => now?.phase === "sending" ? now : latest)
      nextPoll = setTimeout(() => void poll(draft), pollEveryMs)
    }
    void poll(draftId)
    return () => {
      left = true
      clearTimeout(nextPoll)
    }
  })

  async function stop() {
    const draftId = props.draftId
    if (draftId === undefined) return props.onStopUpload()
    setStopping(true)
    try {
      // the submit answers `stopped` next, and whoever sent it moves on
      await stopSubmit(draftId)
    } catch (failure) {
      // too late: the submit ends with a Print Job or a failure as always
      if (failedWith(failure, "not-stoppable")) setProgress({ phase: "sending" })
      setStopping(false)
    }
  }

  return (
    <ThumbScreen
      busy
      actions={
        <Show when={!sending()}>
          <button type="button" class="btn-secondary" disabled={stopping()} onClick={() => void stop()}>
            Abbrechen
          </button>
        </Show>
      }
    >
      <h1 class="text-xl font-bold">
        {uploading() !== undefined
          ? `Wird hochgeladen … ${Math.min(99, Math.round(uploading()! * 100))} %`
          : sending() ? "Wird an den Drucker geschickt …" : "Wird vorbereitet …"}
      </h1>
      <Show when={sheets()}>
        {now => (
          <>
            <p>Blatt {Math.min(now().sheetsDone + 1, now().sheets)} von {now().sheets}</p>
            <progress class="h-2 w-full accent-brand" max={now().sheets} value={now().sheetsDone} aria-label="Fortschritt" />
          </>
        )}
      </Show>
    </ThumbScreen>
  )
}
