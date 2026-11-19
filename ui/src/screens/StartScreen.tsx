import { Show } from "solid-js"
import { FilePicker } from "../controls/FilePicker.tsx"
import { LastJobLine } from "../controls/LastJobLine.tsx"
import { Logo } from "../controls/Logo.tsx"

/** `canReceiveShares`: false over plain HTTP, where the app can't be installed and "Datei auswählen" is the only way in. */
export function StartScreen(props: { canReceiveShares: boolean; onPick: (files: File[]) => void }) {
  return (
    <main class="flex min-h-dvh flex-col gap-6 px-4 pt-4">
      <section class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <Logo class="size-28 drop-shadow-md" />
        <h1 class="text-2xl font-bold">Print Buddy</h1>
        <p class="text-muted">PDFs und Fotos vom Handy drucken</p>
        <Show when={props.canReceiveShares}>
          <p class="text-muted">Teile ein PDF oder Fotos aus einer anderen App mit Print Buddy.</p>
        </Show>
      </section>
      <LastJobLine />
      {/* at the bottom, within reach of the thumb when the phone is held in one hand */}
      <div class="sticky bottom-0 -mx-4 bg-white px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <FilePicker onPick={props.onPick} />
      </div>
    </main>
  )
}
