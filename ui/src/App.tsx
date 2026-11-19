import { createSignal, Match, onSettled, Switch } from "solid-js"
import type { FileFacts, JobSubmitted, Refusal } from "../../shared/api.ts"
import { loggedInParam } from "../../shared/login.ts"
import type { PrintOptions } from "../../shared/print-options.ts"
import { lostShare, sharedParam } from "../../shared/share-target.ts"
import { addFile, checkSession, createDraft, isLoginExpired, onLoginExpired, submitDraft } from "./api.ts"
import { startAppUpdate } from "./app-update.ts"
import { interruptedJob } from "./interrupted-job.ts"
import { lastJob } from "./last-job.ts"
import { phoneFiles } from "./phone-files.ts"
import { fileKind } from "./presets.ts"
import { sendFailure } from "./report.ts"
import { LoginExpiredScreen } from "./screens/LoginExpiredScreen.tsx"
import { OpeningScreen } from "./screens/OpeningScreen.tsx"
import { OptionsScreen } from "./screens/OptionsScreen.tsx"
import { RefusalScreen } from "./screens/RefusalScreen.tsx"
import { SendFailedScreen } from "./screens/SendFailedScreen.tsx"
import { ShareAgainScreen } from "./screens/ShareAgainScreen.tsx"
import { StartScreen } from "./screens/StartScreen.tsx"
import { StatusScreen } from "./screens/StatusScreen.tsx"

/** The phone's copy as the server holds it: `facts[i]` is what the server found out about `files[i]`. */
type Draft = { draftId: string; files: File[]; facts: FileFacts[] }

// The files of a job are not in here from screen to screen: they are the phone's copy (phone-files.ts).
type Screen =
  | { name: "start" }
  /** A share has just come in and its files are on their way to the server. */
  | { name: "opening" }
  /**
   * One PDF, or photos in the order they were shared or picked. `initial`: the Print Options the screen
   * starts with after the login, when the person had chosen them before it ran out.
   */
  | ({ name: "options"; initial?: PrintOptions } & Draft)
  /** `file` is the one the server refused. */
  | { name: "refusal"; refusal: Refusal; file: File }
  /** The files of the job are no longer on the phone: "Bitte nochmal teilen". */
  | { name: "share-again" }
  /** `options` is what was sent, kept for "Nochmal drucken". `since`: when CUPS accepted the job, by the phone's clock. */
  | { name: "status"; options: PrintOptions; job: JobSubmitted; since: number }
  /** Sending didn't work. `options` is what the person chose, kept for "Erneut versuchen"; `error` is what went wrong. */
  | { name: "send-failed"; options: PrintOptions; error: unknown }

/** The app shell: decides which screen shows and moves between them. One screen per file under `screens/`. */
export function App() {
  const address = new URLSearchParams(location.search)
  /** The share went to the server, with or without the login in between: its files are not on the phone. */
  const shareLost = address.get(sharedParam) === lostShare
  /** The service worker has put a share on the phone and sent the browser here. */
  const shared = address.has(sharedParam) && !shareLost
  // taken on every open, so that it can't outlive the page load it was kept for
  const kept = interruptedJob.take()
  /** The person is back from the login, which ran out in the middle of this job. */
  const interrupted = address.has(loggedInParam) ? kept : undefined
  /** The login ran out on the status screen of a Print Job. The person goes back there. */
  const sent = interrupted?.job ? interrupted : undefined
  /** The app opens in the middle of a job, and the phone holds its files. */
  const opensInJob = shared || interrupted !== undefined
  const first: Screen = sent ? { name: "status", ...sent } : opensInJob ? { name: "opening" } : shareLost ? { name: "share-again" } : { name: "start" }
  const [screen, setScreen] = createSignal<Screen>(first)
  const on = <N extends Screen["name"]>(name: N) => {
    const current = screen()
    return current.name === name ? (current as Extract<Screen, { name: N }>) : undefined
  }
  // a share opens the app in the middle of a job; from Start, a job begins with "Datei auswählen"
  const update = startAppUpdate()
  update.setJobInProgress(opensInJob)
  /**
   * The phone holds the files of a job the person can come back to after a login. Not what `update` is
   * told: on the Refusal screen the files are gone, and a new version must still not reload the page.
   */
  let filesHeld = opensInJob
  /** The Print Options the person last tapped Drucken with in this job, for the way back from the login. */
  let lastSent = interrupted?.options

  /** Cloudflare Access has answered a call with 401. Nothing else shows until the person has logged in again. */
  const [loginExpired, setLoginExpired] = createSignal(false)
  onLoginExpired(() => {
    if (loginExpired()) return
    // what the page load of the login would lose; the files are on the phone already
    const current = screen()
    if (current.name === "status") interruptedJob.keep({ options: current.options, job: current.job, since: current.since })
    else if (filesHeld) interruptedJob.keep({ options: lastSent })
    setLoginExpired(true)
  })

  onSettled(() => {
    // only the 401 matters, and that one is reported to onLoginExpired; offline shows when the person prints
    void checkSession().catch(() => {})
    // the address has said how the app was opened; a reload must not take it for a new share or another login
    if (address.size > 0) history.replaceState(null, "", location.pathname)
    // opened without a job in progress: nothing of an earlier one stays on the phone
    if (!opensInJob) void phoneFiles.clear()
    else if (!sent) void openHeld(interrupted?.options)
  })

  /**
   * The person leaves the job, or there is none after all: back to Start, or to "Bitte nochmal teilen"
   * when it was the files that went missing. The phone forgets the files, and a new version of the app
   * that waited may take over.
   */
  function leaveJob(to: "start" | "share-again" = "start") {
    setScreen({ name: to })
    filesHeld = false
    lastSent = undefined
    update.setJobInProgress(false)
    return phoneFiles.clear()
  }

  /**
   * Uploads the phone's copy into a new draft. Every upload goes through here: after a share, after
   * "Datei auswählen", and for "Nochmal drucken" and "Erneut versuchen".
   * Resolves with nothing when there is nothing to print, and has then moved on itself: to "Bitte
   * nochmal teilen" when the phone holds no files, to the Refusal when the server won't take one of
   * them. The same when the login has run out: "Anmeldung abgelaufen" shows by then, and the files stay
   * on the phone.
   */
  async function uploadHeld(): Promise<Draft | undefined> {
    const files = await phoneFiles.held()
    // a share can arrive without its files (lost to the login, or crbug 563075800), and a browser may drop its storage
    if (files.length === 0) {
      await leaveJob("share-again")
      return undefined
    }
    try {
      const { draftId } = await createDraft()
      const facts: FileFacts[] = []
      // one at a time, so the server holds the photos in the order they were shared or picked
      for (const file of files) {
        const answer = await addFile(draftId, file)
        if ("refusal" in answer) {
          // nothing prints, so there is no job to keep the files for
          await phoneFiles.clear()
          filesHeld = false
          setScreen({ name: "refusal", refusal: answer, file })
          return undefined
        }
        facts.push(answer)
      }
      return { draftId, files, facts }
    } catch (failure) {
      if (isLoginExpired(failure)) return undefined
      throw failure
    }
  }

  /**
   * Opens the options screen with the phone's copy. The way in for a share, for "Datei auswählen" and
   * for the way back from the login, which brings the Print Options chosen before it as `initial`.
   */
  async function openHeld(initial?: PrintOptions) {
    const draft = await uploadHeld()
    if (draft) setScreen({ name: "options", ...draft, initial })
  }

  async function pick(files: File[]) {
    filesHeld = true
    lastSent = undefined
    update.setJobInProgress(true)
    await phoneFiles.keep(files)
    await openHeld()
  }

  // a second tap while the first is on its way must not print twice
  let sending = false
  /**
   * Sends the draft as a Print Job. Without a draft ("Nochmal drucken", "Erneut versuchen") the phone's copy is uploaded again first.
   * When that doesn't work, the person lands on "Drucken hat nicht geklappt", unless it was the login that ran out.
   */
  async function print(options: PrintOptions, draftId?: string) {
    if (sending) return
    sending = true
    lastSent = options
    try {
      draftId ??= (await uploadHeld())?.draftId
      if (draftId === undefined) return
      const job = await submitDraft(draftId, options)
      lastJob.remember(job)
      setScreen({ name: "status", options, job, since: Date.now() })
    } catch (error) {
      if (!isLoginExpired(error)) setScreen({ name: "send-failed", options, error })
    } finally {
      sending = false
    }
  }

  return (
    <div class="mx-auto min-h-dvh max-w-[480px] bg-white">
      <Switch>
        {/* first, so that it covers whatever screen the person was on */}
        <Match when={loginExpired()}>
          <LoginExpiredScreen />
        </Match>
        <Match when={on("start")}>
          <StartScreen canReceiveShares={update.hasServiceWorker} onPick={files => void pick(files)} />
        </Match>
        <Match when={on("opening")}>
          <OpeningScreen />
        </Match>
        <Match when={on("refusal")}>
          {refused => <RefusalScreen refusal={refused().refusal} file={refused().file} onPick={files => void pick(files)} />}
        </Match>
        <Match when={on("share-again")}>
          <ShareAgainScreen onPick={files => void pick(files)} />
        </Match>
        <Match when={on("options")}>
          {options => (
            <OptionsScreen
              fileName={options().files.length === 1 ? options().files[0]!.name : `${options().files.length} Fotos`}
              files={options().files}
              facts={options().facts}
              kind={fileKind(options().facts)}
              initial={options().initial}
              onPrint={chosen => void print(chosen, options().draftId)}
              onBack={() => void leaveJob()}
            />
          )}
        </Match>
        {/* keyed: a new Print Job gets a new status screen */}
        <Match when={on("status")} keyed>
          {status => (
            <StatusScreen
              job={status.job}
              since={status.since}
              onClose={() => void leaveJob()}
              onPrintAgain={() => void print(status.options)}
            />
          )}
        </Match>
        <Match when={on("send-failed")}>
          {failed => (
            <SendFailedScreen
              report={{ happened: sendFailure(failed().error), files: phoneFiles.held, options: failed().options }}
              onRetry={() => void print(failed().options)}
              onClose={() => void leaveJob()}
            />
          )}
        </Match>
      </Switch>
    </div>
  )
}
