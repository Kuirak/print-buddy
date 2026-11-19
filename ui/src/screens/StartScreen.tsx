import { Show } from "solid-js"
import { FilePicker } from "../controls/FilePicker.tsx"
import { LastJobLine } from "../controls/LastJobLine.tsx"
import { Logo } from "../controls/Logo.tsx"

/** `canReceiveShares`: false over plain HTTP, where the app can't be installed and "Datei auswählen" is the only way in. */
export function StartScreen(props: { canReceiveShares: boolean; onPick: (files: File[]) => void }) {
  return (
    <main class="flex min-h-dvh flex-col gap-6 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <section class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <Logo class="size-28 drop-shadow-md [@media(max-height:640px)]:size-20" />
        <h1 class="text-2xl font-bold">Print Buddy</h1>
        <p class="text-muted">PDFs und Fotos vom Handy drucken</p>
        <Show when={props.canReceiveShares}>
          <p class="text-muted">Teile ein PDF oder Fotos aus einer anderen App mit Print Buddy.</p>
        </Show>
      </section>
      <LastJobLine />
      {/* last, so that it sits at the bottom within reach of the thumb when the phone is held in one hand. Not sticky:
          when the screen is too short the page scrolls, and nothing lies over "Bericht kopieren" */}
      <FilePicker onPick={props.onPick} />
    </main>
  )
}
