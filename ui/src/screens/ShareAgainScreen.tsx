import { FilePicker } from "../controls/FilePicker.tsx"
import { ThumbScreen } from "../controls/ThumbScreen.tsx"

/**
 * Shown when the files of a job are no longer on the phone: the share was lost to an expired login,
 * or the browser dropped its storage. Nothing prints; the person shares again or picks the file here.
 */
export function ShareAgainScreen(props: { onPick: (files: File[]) => void }) {
  return (
    <ThumbScreen actions={<FilePicker onPick={props.onPick} />}>
      <h1 class="text-xl font-bold">Bitte nochmal teilen</h1>
    </ThumbScreen>
  )
}
