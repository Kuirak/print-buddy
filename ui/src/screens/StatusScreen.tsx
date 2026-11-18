import type { JobSubmitted } from "../../../shared/api.ts"

export function StatusScreen(props: { job: JobSubmitted }) {
  return (
    <main class="flex flex-col gap-2 p-4">
      <h1 class="text-xl font-bold">An den Drucker gesendet</h1>
      <p class="text-muted">Auftrag Nr. {props.job.cupsJobId}</p>
    </main>
  )
}
