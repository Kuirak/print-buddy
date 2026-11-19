import { createSignal, Match, onSettled, Switch } from "solid-js"
import type { FileFacts, JobSubmitted, Refusal } from "../../shared/api.ts"
import type { PrintOptions } from "../../shared/print-options.ts"
import { sharedParam } from "../../shared/share-target.ts"
import { addFile, createDraft, submitDraft } from "./api.ts"
import { startAppUpdate } from "./app-update.ts"
import { lastJob } from "./last-job.ts"
import { phoneFiles } from "./phone-files.ts"
import { fileKind } from "./presets.ts"
import { sendFailure } from "./report.ts"
import { OpeningScreen } from "./screens/OpeningScreen.tsx"
import { OptionsScreen } from "./screens/OptionsScreen.tsx"
import { RefusalScreen } from "./screens/RefusalScreen.tsx"
import { SendFailedScreen } from "./screens/SendFailedScreen.tsx"
import { StartScreen } from "./screens/StartScreen.tsx"
import { StatusScreen } from "./screens/StatusScreen.tsx"

/** The phone's copy as the server holds it: `facts[i]` is what the server found out about `files[i]`. */
type Draft = { draftId: string; files: File[]; facts: FileFacts[] }

// The files of a job are not in here from screen to screen: they are the phone's copy (phone-files.ts).
type Screen =
  | { name: "start" }
  /** A share has just come in and its files are on their way to the server. */
  | { name: "opening" }
  /** One PDF, or photos in the order they were shared or picked. */
  | ({ name: "options" } & Draft)
  /** `file` is the one the server refused. */
  | { name: "refusal"; refusal: Refusal; file: File }
  /** `options` is what was sent, kept for "Nochmal drucken". */
  | { name: "status"; options: PrintOptions; job: JobSubmitted }
  /** Sending didn't work. `options` is what the person chose, kept for "Erneut versuchen"; `error` is what went wrong. */
  | { name: "send-failed"; options: PrintOptions; error: unknown }

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
  function leaveJob() {
    setScreen({ name: "start" })
    update.setJobInProgress(false)
    return phoneFiles.clear()
  }

  /**
   * Uploads the phone's copy into a new draft. Every upload goes through here: after a share, after
   * "Datei auswählen", and for "Nochmal drucken" and "Erneut versuchen".
   * Resolves with nothing when there is nothing to print, and has then moved on itself: to Start when
   * the phone holds no files, to the Refusal when the server won't take one of them.
   */
  async function uploadHeld(): Promise<Draft | undefined> {
    const files = await phoneFiles.held()
    // Chrome can deliver a share without its files (crbug 563075800), and a browser may drop its storage
    if (files.length === 0) {
      await leaveJob()
      return undefined
    }
    const { draftId } = await createDraft()
    const facts: FileFacts[] = []
    // one at a time, so the server holds the photos in the order they were shared or picked
    for (const file of files) {
      const answer = await addFile(draftId, file)
      if ("refusal" in answer) {
        // nothing prints, so there is no job to keep the files for
        await phoneFiles.clear()
        setScreen({ name: "refusal", refusal: answer, file })
        return undefined
      }
      facts.push(answer)
    }
    return { draftId, files, facts }
  }

  /** Opens the options screen with the phone's copy. The way in for a share and for "Datei auswählen". */
  async function openHeld() {
    const draft = await uploadHeld()
    if (draft) setScreen({ name: "options", ...draft })
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
  async function print(options: PrintOptions, draftId?: string) {
    if (sending) return
    sending = true
    try {
      draftId ??= (await uploadHeld())?.draftId
      if (draftId === undefined) return
      const job = await submitDraft(draftId, options)
      lastJob.remember(job)
      setScreen({ name: "status", options, job })
    } catch (error) {
      setScreen({ name: "send-failed", options, error })
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
          {refused => <RefusalScreen refusal={refused().refusal} file={refused().file} onPick={files => void pick(files)} />}
        </Match>
        <Match when={on("options")}>
          {options => (
            <OptionsScreen
              fileName={options().files.length === 1 ? options().files[0]!.name : `${options().files.length} Fotos`}
              kind={fileKind(options().facts)}
              facts={options().facts}
              onPrint={chosen => void print(chosen, options().draftId)}
            />
          )}
        </Match>
        {/* keyed: a new Print Job gets a new status screen */}
        <Match when={on("status")} keyed>
          {status => (
            <StatusScreen job={status.job} onClose={() => void leaveJob()} onPrintAgain={() => void print(status.options)} />
          )}
        </Match>
        <Match when={on("send-failed")}>
          {failed => (
            <SendFailedScreen
              report={{ happened: sendFailure(failed().error), files: phoneFiles.held, options: failed().options }}
              onRetry={() => void print(failed().options)}
            />
          )}
        </Match>
      </Switch>
    </div>
  )
}
