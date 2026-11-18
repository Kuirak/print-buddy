export function StartScreen(props: { onPick: (file: File) => void }) {
  return (
    <main class="flex flex-col gap-6 p-4">
      <h1 class="text-xl font-bold">Print Buddy</h1>
      <label class="btn-primary">
        Datei auswählen
        <input
          type="file"
          accept="application/pdf"
          class="sr-only"
          onChange={event => {
            const file = event.currentTarget.files?.[0]
            if (file) props.onPick(file)
          }}
        />
      </label>
    </main>
  )
}
