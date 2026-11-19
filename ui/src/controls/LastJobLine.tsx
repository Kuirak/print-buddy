import { createSignal, onSettled, Show } from "solid-js"
import { ApiFailure, readJob } from "../api.ts"
import { lastJob } from "../last-job.ts"
import { stateWords } from "../state-words.ts"
import { ReportButton } from "./ReportButton.tsx"

/** The Start screen's line about the last Print Job from this phone. Shows nothing when there is none. */
export function LastJobLine() {
  const job = lastJob.read()
  /** The state as the server says it now; undefined until it has answered. */
  const [state, setState] = createSignal<string>()

  onSettled(() => {
    if (!job) return
    readJob(job.jobId).then(
      status => setState(stateWords[status.state]),
      error => {
        if (error instanceof ApiFailure && error.status === 404) lastJob.forget()
        else setState("unbekannt")
      },
    )
  })

  return (
    <Show when={job && state()}>
      <section class="flex flex-col gap-2">
        <p>Letzter Druck: {state()}</p>
        <ReportButton subject={{ job: job! }} />
      </section>
    </Show>
  )
}
