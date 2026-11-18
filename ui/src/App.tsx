import { createSignal, Match, onSettled, Switch } from "solid-js"
import type { FileFacts, JobSubmitted, Refusal } from "../../shared/api.ts"
import type { PrintOptions } from "../../shared/print-options.ts"
import { addFile, createDraft, submitDraft } from "./api.ts"
import { phoneFiles } from "./phone-files.ts"
import { sharedParam } from "./share-target.ts"
import { OpeningScreen } from "./screens/OpeningScreen.tsx"
import { OptionsScreen } from "./screens/OptionsScreen.tsx"
import { RefusalScreen } from "./screens/RefusalScreen.tsx"
import { StartScreen } from "./screens/StartScreen.tsx"
import { StatusScreen } from "./screens/StatusScreen.tsx"

type Screen =
  | { name: "start" }
  /** A share has just come in and its files are on their way to the server. */
  | { name: "opening" }
  /**
   * One PDF, or photos in the order they were shared or picked. `files` is the phone's copy, `draftId`
   * is the server's copy of them, and `facts[i]` is what the server found out about `files[i]`.
   */
  | { name: "options"; files: File[]; facts: FileFacts[]; draftId: string }
  | { name: "refusal"; refusal: Refusal }
  | { name: "status"; job: JobSubmitted }

/** The app shell: decides which screen shows and moves between them. One screen per file under `screens/`. */
export function App() {
  /** The service worker has put a share on the phone and sent the browser here. */
  const shared = new URLSearchParams(location.search).has(sharedParam)
  const [screen, setScreen] = createSignal<Screen>({ name: shared ? "opening" : "start" })
  const on = <N extends Screen["name"]>(name: N) => {
    const current = screen()
    return current.name === name ? (current as Extract<Screen, { name: N }>) : undefined
  }

  onSettled(() => {
    if (shared) {
      // the files are on the phone now; a reload must not take this for a new share
      history.replaceState(null, "", location.pathname)
      void openHeld()
    } else {
      // opened without a share, no job is in progress: nothing of an earlier one stays on the phone
      void phoneFiles.clear()
    }
  })

  /**
   * Uploads the phone's copy to a new draft and opens the options screen with it. Every way into a job
   * goes through here: a share, "Datei auswählen", and printing the same files again.
   */
  async function openHeld() {
    const files = await phoneFiles.held()
    // Chrome can deliver a share without its files (crbug 563075800); "Datei auswählen" is the way in then
    if (files.length === 0) return setScreen({ name: "start" })
    const { draftId } = await createDraft()
    const facts: FileFacts[] = []
    // one at a time, so the server holds the photos in the order they were shared or picked
    for (const file of files) {
      const answer = await addFile(draftId, file)
      if ("refusal" in answer) {
        // nothing prints, so there is no job to keep the files for
        await phoneFiles.clear()
        return setScreen({ name: "refusal", refusal: answer })
      }
      facts.push(answer)
    }
    setScreen({ name: "options", files, facts, draftId })
  }

  async function pick(files: File[]) {
    await phoneFiles.keep(files)
    await openHeld()
  }

  // a second tap while the first is on its way must not print twice
  let sending = false
  async function print(draftId: string, options: PrintOptions) {
    if (sending) return
    sending = true
    try {
      setScreen({ name: "status", job: await submitDraft(draftId, options) })
    } finally {
      sending = false
    }
  }

  return (
    <div class="mx-auto min-h-dvh max-w-[480px] bg-white">
      <Switch>
        <Match when={on("start")}>
          <StartScreen onPick={files => void pick(files)} />
        </Match>
        <Match when={on("opening")}>
          <OpeningScreen />
        </Match>
        <Match when={on("refusal")}>
          {refused => <RefusalScreen refusal={refused().refusal} onPick={files => void pick(files)} />}
        </Match>
        <Match when={on("options")}>
          {options => (
            <OptionsScreen
              fileName={options().files.length === 1 ? options().files[0]!.name : `${options().files.length} Fotos`}
              onPrint={chosen => void print(options().draftId, chosen)}
            />
          )}
        </Match>
        <Match when={on("status")}>{status => <StatusScreen job={status().job} />}</Match>
      </Switch>
    </div>
  )
}
