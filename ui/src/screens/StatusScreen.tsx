import { createSignal, onSettled, Show, untrack } from "solid-js"
import type { JobStatus, JobSubmitted } from "../../../shared/api.ts"
import { cancelJob, readJob } from "../api.ts"
import { Collapsible } from "../controls/Collapsible.tsx"
import { Dialog } from "../controls/Dialog.tsx"
import { Logo } from "../controls/Logo.tsx"
import { ReportButton } from "../controls/ReportButton.tsx"
import { ThumbScreen } from "../controls/ThumbScreen.tsx"
import { counted, layoutName, paperNames, printedNumbers, printSizeText, ranges } from "../job-text.ts"
import { stateWords } from "../state-words.ts"

const pollEveryMs = 2_000
const hintAfterSeconds = 60

/** A friendly line under the state word, for the states where there is something to say. */
const stateLines: Partial<Record<JobStatus["state"], string>> = {
  waiting: "Der Auftrag ist beim Drucker und wartet, bis er dran ist.",
  printing: "Gleich kommen die Blätter heraus.",
  done: "Dein Ausdruck liegt im Drucker.",
}

/** Whole seconds as m:ss, for example 75 as 1:15. */
function minutesSeconds(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

/**
 * "Nochmal drucken?": what will come out again, read from the ended Print Job, as the confirmation on the
 * options screen says it. The percentage of Einpassen and Füllen isn't known here, so they stand alone.
 */
function PrintAgain(props: { job: JobStatus; onConfirm: () => void; onBack: () => void }) {
  const options = () => props.job.options
  /** What is printed: "3 Seiten (1-2, 5)", "6 Seiten (2 pro Blatt)", "4 Fotos (je 2×; Passbild)". */
  const content = () => {
    const { items, layout } = options()
    const printed = printedNumbers(items)
    const count = printed.length
    const counts = items.filter(item => item.count > 0).map(item => item.count)
    const notes = [
      ...(props.job.file.kind === "pdf" && count < props.job.file.count ? [ranges(printed)] : []),
      ...(counts[0]! > 1 && counts.every(each => each === counts[0]) ? [`je ${counts[0]}×`] : []),
      ...(layout.kind === "format" ? [layoutName(layout)] : layout.perSheet > 1 ? [`${layout.perSheet} pro Blatt`] : []),
    ]
    return (props.job.file.kind === "photo" ? counted(count, "Foto", "Fotos") : counted(count, "Seite", "Seiten")) + (notes.length ? ` (${notes.join("; ")})` : "")
  }
  return (
    <Dialog label="Nochmal drucken?" at="bottom" onClose={props.onBack}>
      <h2 class="text-lg font-bold">Nochmal drucken?</h2>
      <ul class="flex list-disc flex-col gap-1 pl-5">
        <li>
          {content()} × {counted(options().copies, "Kopie", "Kopien")} = <strong>{counted(props.job.sheets, "Blatt", "Blätter")}</strong>
        </li>
        <li>
          {options().color === "color" ? "Farbe" : "Schwarz-Weiß"} · {paperNames[options().paper]} · {printSizeText(options().printSize, undefined)}
          {options().quality === "draft" ? " · Toner sparen" : ""}
        </li>
      </ul>
      <div class="flex gap-2">
        <button type="button" class="btn-secondary" onClick={props.onBack}>Abbrechen</button>
        <button type="button" class="btn-primary" onClick={props.onConfirm}>Drucken</button>
      </div>
    </Dialog>
  )
}

/**
 * Follows one Print Job until it has ended. "Nochmal drucken" asks first, with what will come out.
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
  /** "Nochmal drucken?" is open. */
  const [askingAgain, setAskingAgain] = createSignal(false)

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
    <>
    <ThumbScreen
      inert={askingAgain()}
      actions={
        <>
          <Show when={running()}>
            <Show when={state() === "printing"}>
              <p class="text-sm text-muted">Was der Drucker schon hat, kann noch herauskommen.</p>
            </Show>
            <button type="button" class="btn-secondary" onClick={() => void cancel()}>
              Abbrechen
            </button>
          </Show>
          <Show when={!running()}>
            <button type="button" class="btn-secondary" onClick={() => setAskingAgain(true)}>
              Nochmal drucken
            </button>
            <button type="button" class="btn-primary" onClick={() => props.onClose()}>
              Schließen
            </button>
          </Show>
        </>
      }
    >
      {/* the Print Buddy and the state, in the middle of the screen as on Start; it hums along while it prints */}
      <section class="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <Logo class={`mb-2 size-24 drop-shadow-md [@media(max-height:640px)]:size-16 ${state() === "printing" ? "motion-safe:animate-hum" : ""}`} />
        <h1 class="text-2xl font-bold">{stateWords[state()]}</h1>
        <Show when={stateLines[state()]}>{line => <p>{line()}</p>}</Show>
        <Show when={status()?.reason}>{reason => <p>{reason()}</p>}</Show>
        {/* what is printing: never a file name, which Print Buddy doesn't keep */}
        <Show when={status()}>
          {known => (
            <p class="text-muted">
              {counted(known().sheets, "Blatt", "Blätter")} · {known().options.color === "color" ? "Farbe" : "Schwarz-Weiß"} · {paperNames[known().options.paper]}
            </p>
          )}
        </Show>
        <Show when={running()}>
          <p class="text-muted tabular-nums">läuft seit {minutesSeconds(elapsed())}</p>
        </Show>
        <Show when={state() === "done" && status()}>
          {done => <p class="text-muted tabular-nums">gedauert {minutesSeconds(Math.round((done().endedAt! - done().sentAt) / 1000))}</p>}
        </Show>
      </section>
      <Show when={state() === "waiting" && elapsed() >= hintAfterSeconds}>
        <p class="rounded-lg bg-[#fff1d6] p-3 text-[#7a4b00]">Schläft der Drucker oder ist er aus? Der Auftrag wartet weiter.</p>
      </Show>
      <Show when={state() === "error" && status()}>
        {failed => (
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
        )}
      </Show>
      {/* for when something needs explaining later: quiet, below everything the person needs now */}
      <div class="flex items-center justify-between gap-3 text-sm">
        <span class="text-muted">Auftrag Nr. {props.job.cupsJobId}</span>
        <ReportButton subject={{ job: props.job }} />
      </div>
    </ThumbScreen>
    <Show when={askingAgain() && status()}>
      {ended => (
        <PrintAgain
          job={ended()}
          onConfirm={() => {
            setAskingAgain(false)
            props.onPrintAgain()
          }}
          onBack={() => setAskingAgain(false)}
        />
      )}
    </Show>
    </>
  )
}
