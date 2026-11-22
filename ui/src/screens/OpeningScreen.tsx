import { Logo } from "../controls/Logo.tsx"

/**
 * Shown from the moment a share opens the app, or the person has picked files, until the options screen opens:
 * while the browser reads the files, or, for a file it can't read, until the server has it. Laid out as Start,
 * so that after "Datei auswählen" the Print Buddy stays where it was and gets to work at once.
 */
export function OpeningScreen() {
  return (
    <main class="flex min-h-dvh flex-col px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]" aria-busy="true">
      <section class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <Logo class="size-28 drop-shadow-md motion-safe:animate-hum [@media(max-height:640px)]:size-20" />
        <h1 class="text-2xl font-bold">Print Buddy</h1>
        <p role="status" class="text-muted">Wird geladen …</p>
      </section>
    </main>
  )
}
