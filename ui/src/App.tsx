import { createSignal, Match, onSettled, Switch } from "solid-js"
import type { FileFacts, JobSubmitted, Refusal } from "../../shared/api.ts"
import type { PrintOptions } from "../../shared/print-options.ts"
import { sharedParam } from "../../shared/share-target.ts"
import { addFile, createDraft, submitDraft } from "./api.ts"
import { startAppUpdate } from "./app-update.ts"
import { phoneFiles } from "./phone-files.ts"
import { fileKind } from "./presets.ts"
import { OpeningScreen } from "./screens/OpeningScreen.tsx"
import { OptionsScreen } from "./screens/OptionsScreen.tsx"
import { RefusalScreen } from "./screens/RefusalScreen.tsx"
import { SendFailedScreen } from "./screens/SendFailedScreen.tsx"
import { StartScreen } from "./screens/StartScreen.tsx"
import { StatusScreen } from "./screens/StatusScreen.tsx"

/** The server's copy of picked files: `facts[i]` is what it found out about `files[i]`. */
type Draft = { draftId: string; facts: FileFacts[] }

type Screen =
  | { name: "start" }
  /** A share has just come in and its files are on their way to the server. */
  | { name: "opening" }
  /** One PDF, or photos in the order they were shared or picked. The phone keeps `files` until the person leaves the job. */
  | ({ name: "options"; files: File[] } & Draft)
  | { name: "refusal"; refusal: Refusal }
  /** `files` and `options` are what was sent, kept for "Nochmal drucken". */
  | { name: "status"; files: File[]; options: PrintOptions; job: JobSubmitted }
  /** Sending didn't work. `files` and `options` are what the person wanted to print, kept for "Erneut versuchen". */
  | { name: "send-failed"; files: File[]; options: PrintOptions }

/** The app shell: decides which screen shows and moves between them. One screen per file under `screens/`. */
export function App() {
  /** The service worker has put a share on the phone and sent the browser here. */
  const shared = new URLSearchParams(location.search).has(sharedParam)
  const [screen, setScreen] = createSignal<Screen>({ name: shared ? "opening" : "start" })
  const on = <N extends Screen["name"]>(name: N) => {
    const current = screen()
    return current.name === name ? (current as Extract<Screen, { name: N }>) : undefined
  }
  // a share opens the app in the middle of a job; from Start, a job begins with "Datei auswählen"
  const update = startAppUpdate()
  update.setJobInProgress(shared)

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
   * The person leaves the job, or there is none after all: back to Start. The phone forgets the files,
   * and a new version of the app that waited may take over.
   */
  async function leaveJob() {
    await phoneFiles.clear()
    setScreen({ name: "start" })
    update.setJobInProgress(false)
  }

  /** Uploads the files into a new draft. Resolves with the Refusal when the server won't take one of them. */
  async function upload(files: File[]): Promise<Draft | Refusal> {
    const { draftId } = await createDraft()
    const facts: FileFacts[] = []
    // one at a time, so the server holds the photos in the order they were shared or picked
    for (const file of files) {
      const answer = await addFile(draftId, file)
      if ("refusal" in answer) return answer
      facts.push(answer)
    }
    return { draftId, facts }
  }

  /** Uploads the phone's copy and opens the options screen with it. The way in for a share and for "Datei auswählen". */
  async function openHeld() {
    const files = await phoneFiles.held()
    // Chrome can deliver a share without its files (crbug 563075800); "Datei auswählen" is the way in then
    if (files.length === 0) return leaveJob()
    const draft = await upload(files)
    if ("refusal" in draft) {
      // nothing prints, so there is no job to keep the files for
      await phoneFiles.clear()
      return setScreen({ name: "refusal", refusal: draft })
    }
    setScreen({ name: "options", files, ...draft })
  }

  async function pick(files: File[]) {
    update.setJobInProgress(true)
    await phoneFiles.keep(files)
    await openHeld()
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
          <StartScreen canReceiveShares={update.hasServiceWorker} onPick={files => void pick(files)} />
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
