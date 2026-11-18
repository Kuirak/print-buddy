import { createSignal, Match, Switch } from "solid-js"
import type { JobSubmitted } from "../../shared/api.ts"
import type { PrintOptions } from "../../shared/print-options.ts"
import { addFile, createDraft, submitDraft } from "./api.ts"
import { OptionsScreen } from "./screens/OptionsScreen.tsx"
import { StartScreen } from "./screens/StartScreen.tsx"
import { StatusScreen } from "./screens/StatusScreen.tsx"

type Screen =
  | { name: "start" }
  /** The phone keeps `file`; `draftId` is the server's copy of it. */
  | { name: "options"; file: File; draftId: string }
  | { name: "status"; job: JobSubmitted }

/** The app shell: decides which screen shows and moves between them. One screen per file under `screens/`. */
export function App() {
  const [screen, setScreen] = createSignal<Screen>({ name: "start" })
  const on = <N extends Screen["name"]>(name: N) => {
    const current = screen()
    return current.name === name ? (current as Extract<Screen, { name: N }>) : undefined
  }

  async function pick(file: File) {
    const { draftId } = await createDraft()
    await addFile(draftId, file)
    setScreen({ name: "options", file, draftId })
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
          <StartScreen onPick={file => void pick(file)} />
        </Match>
        <Match when={on("options")}>
          {options => <OptionsScreen fileName={options().file.name} onPrint={chosen => void print(options().draftId, chosen)} />}
        </Match>
        <Match when={on("status")}>{status => <StatusScreen job={status().job} />}</Match>
      </Switch>
    </div>
  )
}
