import { createSignal, Match, Switch } from "solid-js"
import type { JobSubmitted } from "../../shared/api.ts"
import { addFile, createDraft, submitDraft } from "./api.ts"
import { OptionsScreen } from "./screens/OptionsScreen.tsx"
import { StartScreen } from "./screens/StartScreen.tsx"
import { StatusScreen } from "./screens/StatusScreen.tsx"

/** The phone keeps `file` until the person leaves the job; the server's copy of it is the draft. */
type Screen =
  | { name: "start" }
  | { name: "options"; file: File; draftId: string }
  | { name: "status"; file: File; job: JobSubmitted }

/** The app shell: decides which screen shows and moves between them. One screen per file under `screens/`. */
export function App() {
  const [screen, setScreen] = createSignal<Screen>({ name: "start" })
  const on = <N extends Screen["name"]>(name: N) => {
    const current = screen()
    return current.name === name ? (current as Extract<Screen, { name: N }>) : undefined
  }

  async function upload(file: File) {
    const { draftId } = await createDraft()
    await addFile(draftId, file)
    return draftId
  }

  async function pick(file: File) {
    setScreen({ name: "options", file, draftId: await upload(file) })
  }

  // a second tap while the first is on its way must not print twice
  let sending = false
  /** Sends the draft as a Print Job. Without a draft ("Nochmal drucken") the phone's copy is uploaded again first. */
  async function print(file: File, draftId?: string) {
    if (sending) return
    sending = true
    try {
      const job = await submitDraft(draftId ?? await upload(file))
      setScreen({ name: "status", file, job })
    } finally {
      sending = false
    }
  }

  return (
    <div class="mx-auto min-h-dvh max-w-[480px] bg-white">
      <Switch>
        <Match when={on("start")}>
          <StartScreen onPick={file => void pick(file)} />
        </Match>
        <Match when={on("options")}>
          {options => <OptionsScreen fileName={options().file.name} onPrint={() => void print(options().file, options().draftId)} />}
        </Match>
        {/* keyed: a new Print Job gets a new status screen */}
        <Match when={on("status")} keyed>
          {status => (
            <StatusScreen job={status.job} onClose={() => setScreen({ name: "start" })} onPrintAgain={() => void print(status.file)} />
          )}
        </Match>
      </Switch>
    </div>
  )
}
