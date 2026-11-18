export function OptionsScreen(props: { fileName: string; onPrint: () => void }) {
  return (
    <main class="flex min-h-dvh flex-col gap-4 p-4">
      <h1 class="truncate font-bold">{props.fileName}</h1>
      <div class="sticky bottom-0 mt-auto bg-white py-3">
        <button type="button" class="btn-primary" onClick={() => props.onPrint()}>
          Drucken
        </button>
      </div>
    </main>
  )
}
