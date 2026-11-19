/**
 * Shown from the moment a share opens the app until the options screen opens: while the browser reads the
 * files, or, for a file it can't read, until the server has it.
 */
export function OpeningScreen() {
  return (
    <main class="flex flex-col gap-6 p-4" aria-busy="true">
      <h1 class="text-xl font-bold">Print Buddy</h1>
      <p role="status" class="text-muted">Wird geladen …</p>
    </main>
  )
}
