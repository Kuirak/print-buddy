import { Show } from "solid-js"
import { FilePicker } from "../controls/FilePicker.tsx"
import { LastJobLine } from "../controls/LastJobLine.tsx"

/** `canReceiveShares`: false over plain HTTP, where the app can't be installed and "Datei auswählen" is the only way in. */
export function StartScreen(props: { canReceiveShares: boolean; onPick: (files: File[]) => void }) {
  return (
    <main class="flex flex-col gap-6 p-4">
      <h1 class="text-xl font-bold">Print Buddy</h1>
      <Show when={props.canReceiveShares}>
        <p class="text-muted">Teile ein PDF oder Fotos aus einer anderen App mit Print Buddy.</p>
      </Show>
      <FilePicker onPick={props.onPick} />
      <LastJobLine />
    </main>
  )
}
