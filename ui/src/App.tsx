import { createSignal, Match, Switch } from "solid-js"
import type { FileFacts, JobSubmitted, Refusal } from "../../shared/api.ts"
import type { PrintOptions } from "../../shared/print-options.ts"
import { addFile, createDraft, submitDraft } from "./api.ts"
import { OptionsScreen } from "./screens/OptionsScreen.tsx"
import { RefusalScreen } from "./screens/RefusalScreen.tsx"
import { StartScreen } from "./screens/StartScreen.tsx"
import { StatusScreen } from "./screens/StatusScreen.tsx"

type Screen =
  | { name: "start" }
  /**
   * One PDF, or photos in the order they were picked. The phone keeps `files`; `draftId` is the server's
   * copy of them, and `facts[i]` is what the server found out about `files[i]`.
   */
  | { name: "options"; files: File[]; facts: FileFacts[]; draftId: string }
  | { name: "refusal"; refusal: Refusal }
  | { name: "status"; job: JobSubmitted }

/** The app shell: decides which screen shows and moves between them. One screen per file under `screens/`. */
export function App() {
  const [screen, setScreen] = createSignal<Screen>({ name: "start" })
  const on = <N extends Screen["name"]>(name: N) => {
    const current = screen()
    return current.name === name ? (current as Extract<Screen, { name: N }>) : undefined
  }

  async function pick(files: File[]) {
    const { draftId } = await createDraft()
    const facts: FileFacts[] = []
    // one at a time, so the server holds the photos in the order they were picked
    for (const file of files) {
      const answer = await addFile(draftId, file)
      if ("refusal" in answer) return setScreen({ name: "refusal", refusal: answer })
      facts.push(answer)
    }
    setScreen({ name: "options", files, facts, draftId })
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
