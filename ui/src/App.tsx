import { createSignal, Match, onSettled, Switch } from "solid-js"
import type { FileFacts, JobSubmitted, Refusal } from "../../shared/api.ts"
import { loggedInParam } from "../../shared/login.ts"
import type { PrintOptions } from "../../shared/print-options.ts"
import { lostShare, sharedParam } from "../../shared/share-target.ts"
import { checkSession, failedWith, isLoginExpired, onLoginExpired, submitDraft } from "./api.ts"
import { startAppUpdate } from "./app-update.ts"
import { readFacts } from "./file-facts.ts"
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
import { SendingScreen } from "./screens/SendingScreen.tsx"
import { ShareAgainScreen } from "./screens/ShareAgainScreen.tsx"
import { StartScreen } from "./screens/StartScreen.tsx"
import { StatusScreen } from "./screens/StatusScreen.tsx"
import { startUpload, type Draft, type Upload, type UploadEnd } from "./upload.ts"

/**
 * The options screen: one PDF, or photos in the order they were shared or picked, while `upload` puts them on the server.
 * `facts` are what the browser read from them, or the server's when the browser couldn't read them.
 * `initial`: the Print Options the screen starts with in place of the starred Preset: after the login, when the person
 * had chosen them before it ran out, and after Abbrechen while the Print Job was prepared.
 */
type OptionsState = { name: "options"; files: File[]; facts: FileFacts[]; upload: Upload; initial?: PrintOptions }

// The files of a job are not in here from screen to screen: they are the phone's copy (phone-files.ts).
type Screen =
  | { name: "start" }
  /** A share has just come in and the browser reads its files. */
  | { name: "opening" }
  | OptionsState
  /** `file` is the one the server refused. */
  | { name: "refusal"; refusal: Refusal; file: File }
  /** The files of the job are no longer on the phone: "Bitte nochmal teilen". */
  | { name: "share-again" }
  /** `options` is what was sent, kept for "Nochmal drucken". `since`: when CUPS accepted the job, by the phone's clock. */
  | { name: "status"; options: PrintOptions; job: JobSubmitted; since: number }
  /**
   * Printing has started and the submit hasn't answered yet. `upload` is the upload of the phone's copy for
   * "Nochmal drucken" and "Erneut versuchen"; `draftId` is the draft being submitted, once every file is there.
   */
  | { name: "sending"; upload?: Upload; draftId?: string }
  /**
   * Sending didn't work; `error` is what went wrong. `options` is what the person chose, kept for "Erneut
   * versuchen": after Drucken it sends them again. When the upload failed while the options screen
   * showed (`printed: false`), it opens the options screen again with them.
   */
  | ({ name: "send-failed"; error: unknown } & ({ printed: true; options: PrintOptions } | { printed: false; options?: PrintOptions }))

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
  /**
   * The Print Options the person last chose in this job, on the options screen or with Drucken, for the
   * way back from the login.
   */
  let chosen = interrupted?.options
  /** The upload of the job's files, from its start until the person leaves the job or the server refused a file. */
  let upload: Upload | undefined

  /** Cloudflare Access has answered a call with 401. Nothing else shows until the person has logged in again. */
  const [loginExpired, setLoginExpired] = createSignal(false)
  onLoginExpired(() => {
    if (loginExpired()) return
    // what the page load of the login would lose; the files are on the phone already
    const current = screen()
    if (current.name === "status") interruptedJob.keep({ options: current.options, job: current.job, since: current.since })
    else if (filesHeld) interruptedJob.keep({ options: chosen })
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
   * when it was the files that went missing. A running upload stops, the phone forgets the files, and a
   * new version of the app that waited may take over.
   */
  function leaveJob(to: "start" | "share-again" = "start") {
    upload?.stop()
    upload = undefined
    setScreen({ name: to })
    filesHeld = false
    chosen = undefined
    update.setJobInProgress(false)
    return phoneFiles.clear()
  }

  /**
   * Starts uploading the phone's copy into a new draft, or `files` after the files of `onto`. Every upload goes through
   * here: after a share, after "Datei auswählen", after "Fotos hinzufügen", and for "Nochmal drucken" and "Erneut
   * versuchen". When the server refuses a file, the Refusal screen shows, whatever screen shows then. Other failures
   * are for the caller.
   */
  function beginUpload(files: File[], onto?: Draft): Upload {
    upload?.stop()
    const started = startUpload(files, onto)
    upload = started
    void started.done.then(async end => {
      if (upload !== started || !("refusal" in end)) return
      // nothing prints, so there is no job to keep the files for
      upload = undefined
      filesHeld = false
      await phoneFiles.clear()
      setScreen({ name: "refusal", refusal: end.refusal, file: end.file })
    }, () => {})
    return started
  }

  /**
   * Opens the options screen with the phone's copy, for a share, for the way back from the login, which brings the
   * Print Options chosen before it as `initial`, and for "Erneut versuchen" when the upload failed before Drucken.
   * Goes to "Bitte nochmal teilen" when the phone holds no files.
   */
  async function openHeld(initial?: PrintOptions) {
    const files = await phoneFiles.held()
    // a share can arrive without its files (lost to the login, or crbug 563075800), and a browser may drop its storage
    if (files.length === 0) {
      await leaveJob("share-again")
      return
    }
    await openFiles(files, initial)
  }

  /**
   * Opens the options screen with `files` as soon as the browser has read their facts, and uploads them meanwhile.
   * With `onto`, the draft that holds the files before them, only the rest is uploaded, after those.
   */
  async function openFiles(files: File[], initial?: PrintOptions, onto?: Draft) {
    const started = onto ? beginUpload(files.slice(onto.facts.length), onto) : beginUpload(files)
    // a 401 shows "Anmeldung abgelaufen" by itself, and the files stay on the phone for after the login
    started.done.catch(error => {
      if (upload !== started || isLoginExpired(error)) return
      upload = undefined
      setScreen({ name: "send-failed", printed: false, options: chosen, error })
    })
    // a file the browser can't read waits for the server, which may refuse it
    const facts = await readFacts(files) ?? await started.done.then(end => "draft" in end ? end.draft.facts : undefined, () => undefined)
    if (facts && upload === started) setScreen({ name: "options", files, facts, upload: started, initial })
  }

  /**
   * "Fotos hinzufügen" on the options screen `from`: the photos come after the ones there, each printed once, and
   * those keep what `options` chose for them. When every photo before is on the server already, only the new ones are
   * uploaded, into the same draft; else the upload starts again with all of them.
   */
  async function addPhotos(from: OptionsState, added: File[], options: PrintOptions) {
    const files = [...from.files, ...added]
    chosen = { ...options, items: [...options.items, ...added.map(() => ({ count: 1, turn: 0 as const }))] }
    // the screen before must not print the photos without the new ones meanwhile
    setScreen({ name: "opening" })
    void phoneFiles.keep(files).catch(() => {})
    await openFiles(files, chosen, from.upload.draft())
  }

  /**
   * "Datei auswählen". The loading screen shows at once, and the picked files open without waiting for the phone's
   * copy: writing several large photos to it takes seconds on a phone. Everything that reads the copy later waits for
   * the write (see `phoneFiles`).
   */
  async function pick(files: File[]) {
    filesHeld = true
    chosen = undefined
    update.setJobInProgress(true)
    setScreen({ name: "opening" })
    // a copy that can't be written shows only later: "Nochmal drucken" or the way back from the login then find no files
    void phoneFiles.keep(files).catch(() => {})
    await openFiles(files)
  }

  /**
   * Uploads the phone's copy into a new draft while the sending screen shows it, and resolves with how the upload
   * ended. Resolves with nothing when the phone holds no files, and has then moved on to "Bitte nochmal teilen".
   * A Refusal shows by itself, through `beginUpload`.
   */
  async function uploadHeld(): Promise<UploadEnd | undefined> {
    const files = await phoneFiles.held()
    if (files.length === 0) {
      await leaveJob("share-again")
      return undefined
    }
    const started = beginUpload(files)
    setScreen({ name: "sending", upload: started })
    return await started.done
  }

  // a second tap while the first is on its way must not print twice
  let sending = false
  /**
   * Sends the draft of the options screen `from` as a Print Job, while the sending screen shows. Without it ("Nochmal
   * drucken", "Erneut versuchen") the phone's copy is uploaded again first. When that doesn't work, the person lands on
   * "Drucken hat nicht geklappt", unless it was the login that ran out. Abbrechen on the sending screen leads back to
   * `from` with the Print Options just sent, or to a new options screen with them.
   */
  async function print(options: PrintOptions, from?: OptionsState) {
    if (sending) return
    sending = true
    chosen = options
    const back = () => {
      if (from) setScreen({ ...from, initial: options })
      else void openHeld(options)
    }
    try {
      let draftId = from?.upload.draft()?.draftId
      if (draftId === undefined) {
        const end = await uploadHeld()
        // while the sending screen shows, only its Abbrechen stops the upload
        if (end && "stopped" in end) return back()
        if (!end || !("draft" in end)) return
        draftId = end.draft.draftId
      }
      setScreen({ name: "sending", draftId })
      const job = await submitDraft(draftId, options)
      lastJob.remember(job)
      setScreen({ name: "status", options, job, since: Date.now() })
    } catch (error) {
      // Abbrechen stopped the submit while it prepared: nothing was printed, and the draft is still there
      if (failedWith(error, "stopped")) back()
      else if (!isLoginExpired(error)) setScreen({ name: "send-failed", printed: true, options, error })
    } finally {
      sending = false
    }
  }

  return (
    // the options screen grows with the screen: one wider column on a tablet, two columns from 1024 px
    <div class={`mx-auto min-h-dvh bg-white ${screen().name === "options" && !loginExpired() ? "max-w-[480px] md:max-w-xl lg:max-w-6xl" : "max-w-[480px]"}`}>
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
        {/* keyed: new files get a new options screen */}
        <Match when={on("options")} keyed>
          {options => (
            <OptionsScreen
              fileName={options.files.length === 1 ? options.files[0]!.name : `${options.files.length} Fotos`}
              files={options.files}
              facts={options.upload.draft()?.facts ?? options.facts}
              uploading={options.upload.draft() ? undefined : options.upload.progress()}
              kind={fileKind(options.facts)}
              initial={options.initial}
              onChange={changed => { chosen = changed }}
              onPrint={changed => void print(changed, options)}
              onAddPhotos={(added, changed) => void addPhotos(options, added, changed)}
              onBack={() => void leaveJob()}
            />
          )}
        </Match>
        {/* not keyed: the same sending screen goes on from the upload to the submit */}
        <Match when={on("sending")}>
          {sent => (
            <SendingScreen
              uploading={sent().upload?.progress()}
              draftId={sent().draftId}
              onStopUpload={() => sent().upload?.stop()}
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
              error={failed().error}
              report={{ happened: sendFailure(failed().error), files: phoneFiles.held, options: failed().options }}
              onRetry={() => {
                const current = failed()
                if (current.printed) void print(current.options)
                else void openHeld(current.options)
              }}
              // the options screen again, with what was sent, to change it; the upload failure's retry already does that
              onEdit={failed().printed ? () => void openHeld(failed().options) : undefined}
              onClose={() => void leaveJob()}
            />
          )}
        </Match>
      </Switch>
    </div>
  )
}
