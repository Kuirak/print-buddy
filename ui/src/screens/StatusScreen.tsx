import { createSignal, onSettled, Show, untrack } from "solid-js"
import type { JobStatus, JobSubmitted } from "../../../shared/api.ts"
import { cancelJob, readJob } from "../api.ts"
import { Collapsible } from "../controls/Collapsible.tsx"
import { ReportButton } from "../controls/ReportButton.tsx"
import { stateWords } from "../state-words.ts"

const pollEveryMs = 2_000
const hintAfterSeconds = 60

/** Whole seconds as m:ss, for example 75 as 1:15. */
function minutesSeconds(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

/**
 * Follows one Print Job until it has ended.
 * `since`: when CUPS accepted the job, by the phone's clock. Left out it is now, because the screen
 * opens as soon as the job is sent. The way back from the login brings the earlier time.
 */
export function StatusScreen(props: { job: JobSubmitted; since?: number; onClose: () => void; onPrintAgain: () => void }) {
  // CUPS has just accepted the job, so it waits until the server says otherwise
  const [status, setStatus] = createSignal<JobStatus>()
  const state = () => status()?.state ?? "waiting"
  const running = () => state() === "waiting" || state() === "printing"
  const since = untrack(() => props.since) ?? Date.now()
  /** Seconds since CUPS accepted the job. */
  const [elapsed, setElapsed] = createSignal(0)

  let ticking: ReturnType<typeof setInterval> | undefined
  let nextPoll: ReturnType<typeof setTimeout> | undefined
  /** Nothing more to follow: the job has ended, or the screen was left. */
  let stopped = false
  function stop() {
    stopped = true
    clearInterval(ticking)
    clearTimeout(nextPoll)
  }

  /** Takes over what the server says. An ended job no longer changes, so a late answer is ignored. */
  function show(latest: JobStatus) {
    if (stopped) return
    setStatus(latest)
    if (latest.endedAt !== null) stop()
  }

  async function poll() {
    // a read that fails is tried again with the next poll
    const latest = await readJob(props.job.jobId).catch(() => undefined)
    if (latest) show(latest)
    if (!stopped) nextPoll = setTimeout(() => void poll(), pollEveryMs)
  }

  async function cancel() {
    // when the server refuses, the next poll shows where the job is now
    const latest = await cancelJob(props.job.jobId).catch(() => undefined)
    if (latest) show(latest)
  }

  onSettled(() => {
    const tick = () => setElapsed(Math.floor((Date.now() - since) / 1000))
    tick()
    ticking = setInterval(tick, 1000)
    void poll()
    return stop
  })

  return (
    <main class="flex flex-col gap-2 p-4">
      <h1 class="text-xl font-bold">{stateWords[state()]}</h1>
      <Show when={running()}>
        <p>läuft seit {minutesSeconds(elapsed())}</p>
      </Show>
      <Show when={state() === "done" && status()}>
        {done => <p>gedauert {minutesSeconds(Math.round((done().endedAt! - done().sentAt) / 1000))}</p>}
      </Show>
      <Show when={status()?.reason}>{reason => <p>{reason()}</p>}</Show>
      <p class="text-muted">Auftrag Nr. {props.job.cupsJobId}</p>
      <Show when={state() === "waiting" && elapsed() >= hintAfterSeconds}>
        <p class="rounded-lg bg-[#fff1d6] p-3 text-[#7a4b00]">Schläft der Drucker oder ist er aus? Der Auftrag wartet weiter.</p>
      </Show>
      <Show when={state() === "error" && status()}>
        {failed => (
          <>
            <Collapsible title="Details">
              <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt class="text-muted">Meldung</dt>
                <dd>{failed().details.printerMessage || "–"}</dd>
                <dt class="text-muted">Zustand</dt>
                <dd>{failed().details.jobState}</dd>
                <dt class="text-muted">Gründe</dt>
                <dd>{[...failed().details.jobStateReasons, ...failed().details.printerStateReasons].join(", ")}</dd>
              </dl>
              <p class="mt-1 text-sm">CUPS-Auftrag Nr. {failed().cupsJobId}</p>
            </Collapsible>
          </>
        )}
      </Show>
      <Show when={state() === "waiting"}>
        <button type="button" class="btn-secondary mt-4" onClick={() => void cancel()}>
          Abbrechen
        </button>
      </Show>
      <Show when={!running()}>
        <div class="mt-4 flex flex-col gap-2">
          <button type="button" class="btn-primary" onClick={() => props.onClose()}>
            Schließen
          </button>
          <button type="button" class="btn-secondary" onClick={() => props.onPrintAgain()}>
            Nochmal drucken
          </button>
        </div>
      </Show>
      <div class="mt-2">
        <ReportButton subject={{ job: props.job }} />
      </div>
    </main>
  )
}
