import { createSignal, Match, Switch } from "solid-js"
import type { FileFacts, JobSubmitted, Refusal } from "../../shared/api.ts"
import type { PrintOptions } from "../../shared/print-options.ts"
import { addFile, createDraft, submitDraft } from "./api.ts"
import { fileKind } from "./presets.ts"
import { OptionsScreen } from "./screens/OptionsScreen.tsx"
import { RefusalScreen } from "./screens/RefusalScreen.tsx"
import { SendFailedScreen } from "./screens/SendFailedScreen.tsx"
import { StartScreen } from "./screens/StartScreen.tsx"
import { StatusScreen } from "./screens/StatusScreen.tsx"

/** The server's copy of picked files: `facts[i]` is what it found out about `files[i]`. */
type Draft = { draftId: string; facts: FileFacts[] }

type Screen =
  | { name: "start" }
  /** One PDF, or photos in the order they were picked. The phone keeps `files` until the person leaves the job. */
  | ({ name: "options"; files: File[] } & Draft)
  | { name: "refusal"; refusal: Refusal }
  /** `files` and `options` are what was sent, kept for "Nochmal drucken". */
  | { name: "status"; files: File[]; options: PrintOptions; job: JobSubmitted }
  /** Sending didn't work. `files` and `options` are what the person wanted to print, kept for "Erneut versuchen". */
  | { name: "send-failed"; files: File[]; options: PrintOptions }

/** The app shell: decides which screen shows and moves between them. One screen per file under `screens/`. */
export function App() {
  const [screen, setScreen] = createSignal<Screen>({ name: "start" })
  const on = <N extends Screen["name"]>(name: N) => {
    const current = screen()
    return current.name === name ? (current as Extract<Screen, { name: N }>) : undefined
  }

  /** Uploads the files into a new draft. Resolves with the Refusal when the server won't take one of them. */
  async function upload(files: File[]): Promise<Draft | Refusal> {
    const { draftId } = await createDraft()
    const facts: FileFacts[] = []
    // one at a time, so the server holds the photos in the order they were picked
    for (const file of files) {
      const answer = await addFile(draftId, file)
      if ("refusal" in answer) return answer
      facts.push(answer)
    }
    return { draftId, facts }
  }

  async function pick(files: File[]) {
    const draft = await upload(files)
    setScreen("refusal" in draft ? { name: "refusal", refusal: draft } : { name: "options", files, ...draft })
  }

  // a second tap while the first is on its way must not print twice
  let sending = false
  /**
   * Sends the draft as a Print Job. Without a draft ("Nochmal drucken", "Erneut versuchen") the phone's copy is uploaded again first.
   * When that doesn't work, for whatever reason, the person lands on "Drucken hat nicht geklappt".
   */
  async function print(files: File[], options: PrintOptions, draftId?: string) {
    if (sending) return
    sending = true
    try {
      if (draftId === undefined) {
        const draft = await upload(files)
        if ("refusal" in draft) {
          setScreen({ name: "refusal", refusal: draft })
          return
        }
        draftId = draft.draftId
      }
      setScreen({ name: "status", files, options, job: await submitDraft(draftId, options) })
    } catch {
      setScreen({ name: "send-failed", files, options })
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
              kind={fileKind(options().facts)}
              facts={options().facts}
              onPrint={chosen => void print(options().files, chosen, options().draftId)}
            />
          )}
        </Match>
        {/* keyed: a new Print Job gets a new status screen */}
        <Match when={on("status")} keyed>
          {status => (
            <StatusScreen
              job={status.job}
              onClose={() => setScreen({ name: "start" })}
              onPrintAgain={() => void print(status.files, status.options)}
            />
          )}
        </Match>
        <Match when={on("send-failed")}>
          {failed => <SendFailedScreen onRetry={() => void print(failed().files, failed().options)} />}
        </Match>
      </Switch>
    </div>
  )
}
