import { FilePicker } from "../controls/FilePicker.tsx"

export function StartScreen(props: { onPick: (files: File[]) => void }) {
  return (
    <main class="flex flex-col gap-6 p-4">
      <h1 class="text-xl font-bold">Print Buddy</h1>
      <FilePicker onPick={props.onPick} />
    </main>
  )
}
