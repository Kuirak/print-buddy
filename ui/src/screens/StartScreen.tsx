import { Show } from "solid-js"
import { FilePicker } from "../controls/FilePicker.tsx"
import { LastJobLine } from "../controls/LastJobLine.tsx"
import { Logo } from "../controls/Logo.tsx"

declare const __APP_VERSION__: string

/** `canReceiveShares`: false over plain HTTP, where the app can't be installed and "Datei auswählen" is the only way in. */
export function StartScreen(props: { canReceiveShares: boolean; onPick: (files: File[]) => void }) {
  return (
    <main class="flex min-h-dvh flex-col gap-6 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <section class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <Logo class="size-28 -rotate-3 drop-shadow-md [@media(max-height:640px)]:size-20" />
        <h1 class="text-3xl underline decoration-brand/40 decoration-wavy underline-offset-8">Print Buddy</h1>
        {/* the caption of the name, where one looks to tell which app this is; out of the thumb's way at the bottom */}
        <p class="mt-1 text-xs text-muted tabular-nums">Version {__APP_VERSION__}</p>
        {/* what the app is for, on a note stuck to the page */}
        <div class="note scribble tape mt-3 -rotate-1 bg-note-yellow">
          <p>PDFs und Fotos vom Handy drucken</p>
          <Show when={props.canReceiveShares}>
            <p class="mt-2">Teile ein PDF oder Fotos aus einer anderen App mit Print Buddy.</p>
          </Show>
        </div>
      </section>
      <LastJobLine />
      {/* last, so that it sits at the bottom within reach of the thumb when the phone is held in one hand. Not sticky:
          when the screen is too short the page scrolls, and nothing lies over "Bericht kopieren" */}
      <FilePicker onPick={props.onPick} />
    </main>
  )
}
