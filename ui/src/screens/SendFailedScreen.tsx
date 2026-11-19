/** Shown when a Print Job could not be sent. The app still holds the file and the Print Options, so the same job can be sent again. */
export function SendFailedScreen(props: { onRetry: () => void }) {
  return (
    <main class="flex flex-col gap-6 p-4">
      <h1 class="text-xl font-bold">Drucken hat nicht geklappt</h1>
      <button type="button" class="btn-primary" onClick={() => props.onRetry()}>
        Erneut versuchen
      </button>
    </main>
  )
}
