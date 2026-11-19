# Print Buddy

A small web app for printing PDFs and photos from the family's Android phones on the household Printer. It runs as a Home Assistant add-on next to the CUPS add-on. The vocabulary is in `GLOSSARY.md`.

This repository is also the Home Assistant add-on repository: `repository.yaml` at the root, the add-on in `print-buddy/`. Home Assistant pulls a ready-made image for the Raspberry Pi 4 (aarch64) and builds nothing.

## Install in Home Assistant

1. The CUPS add-on must be running, with a queue that prints a test page.
2. Settings > Apps > Install app > ⋮ > Repositories: add `https://github.com/Kuirak/print-buddy`. Always enter it exactly like this. Home Assistant derives the add-on's internal hostname from the text of this URL.
3. Install **Print Buddy** from the store. Enter `printer_name` (the name of the CUPS queue; Home Assistant asks for it before the first start) and check `upload_limit_mb`, turn on **Watchdog** and **Start on boot**, then start it. The Documentation tab (`print-buddy/DOCS.md`) explains the options, the optional LAN port and where the job files are.

## Cloudflare setup

Do the steps in this order. The Access application comes first, so the hostname is never reachable without a login.

### 1. Access application

In Cloudflare Zero Trust, add a self-hosted Access application:

- Hostname `print.example.org`, no path.
- One Allow policy that lists the 2 family email addresses.
- Login by one-time PIN only, with instant authentication on.
- Session duration 1 month, for the application and for the global session.
- No Bypass policy, and leave the cookie's SameSite setting at its default.

### 2. Tunnel route with "Protect with Access"

The tunnel runs in token mode, so its routes are set in the dashboard. Add a published application route:

- Hostname `print.example.org`.
- Service `http://0086bcee-print-buddy:9217`. This is the add-on's hostname inside Home Assistant. It needs no host port, so leave the port under Network empty.
- Turn on **Protect with Access** and pick the application from step 1. cloudflared then drops every request that carries no valid Access login.

`0086bcee` is derived from the repository URL as it was entered in step 2 of the install. For another URL, compute it with `printf %s "<url in lower case>" | shasum | cut -c1-8`, or read the hostname on the add-on's page.

Check: `https://print.example.org` in a private window shows the Cloudflare login, and after the PIN it shows Print Buddy.

### 3. Install on the phones from Chrome

On each Android phone:

1. Open `https://print.example.org` in Chrome and log in with the PIN.
2. Chrome menu > "Zum Startbildschirm hinzufügen" > "Installieren".
3. Share a PDF from another app. "Print Buddy" must be in the share sheet.

Then go through the on-device checks below.

### On-device checks (first build, by hand)

No test covers the installed app on a phone: the install, the share sheet and the update all need a real Android Chrome. Do these once on each Android phone with the first build, through `https://print.example.org`, and again after a change to `ui/public/manifest.webmanifest`, `ui/src/sw.ts` or `ui/src/app-update.ts`.

- [ ] **Install.** Chrome offers "Installieren" (not only a plain shortcut). The app opens in its own window without the address bar, with the printer icon and the name "Print Buddy". The Start screen shows "Teile ein PDF oder Fotos aus einer anderen App mit Print Buddy." If Chrome offers no install, apply the Bypass fallback below.
- [ ] **Share a PDF.** In another app (Files, Gmail, Drive) share one PDF and pick Print Buddy in the share sheet. The options screen opens with the file's name, without a tap in between. Print it; the status screen follows the job.
- [ ] **Share photos.** In the gallery select three photos and share them to Print Buddy. The options screen opens with "3 Fotos". They print in the order they were selected, one per sheet.
- [ ] **Refused shares.** Share 21 photos: "Höchstens 20 Fotos auf einmal". Share two PDFs: "Bitte jeweils nur eine Datei teilen". Share a PDF together with a photo: "Bitte PDF und Fotos getrennt teilen". All three screens offer "Datei auswählen", and nothing prints.
- [ ] **Print again from the phone's copy.** After "Fertig" tap "Nochmal drucken": a second job prints without sharing again. Then tap "Schließen".
- [ ] **Update after a new version.** Install a newer add-on version in Home Assistant. Open Print Buddy on the phone and wait a few seconds on the Start screen: the app reloads once by itself, into the new version (check with whatever the release changed on screen).
- [ ] **No update in the middle of a job.** Install a newer add-on version, then share a PDF and stay on the options screen for half a minute: the screen must not reload. Print, tap "Schließen": now the app reloads into the new version.
- [ ] **A share that arrives empty.** If a share opens Print Buddy on "Bitte nochmal teilen" instead of the options screen, that phone's Chrome delivers shares without their files (a known Chrome bug on Chrome 153 with Android 17), or the share went to the server because the app's service worker was not running yet. "Datei auswählen" still works; share once more, and if it happens again note the Chrome version.

Behaviour after the session expires. The login lasts a month, so end it by hand before each of these: open `https://print.example.org/cdn-cgi/access/logout` in Chrome on the phone. If Print Buddy still gets through afterwards, revoke the person's session in Cloudflare Zero Trust instead and note that. Do these again after a change to `ui/src/interrupted-job.ts`, the login address in `shared/login.ts` or the Access application.

- [ ] **Expired login when the app opens.** End the login, then open Print Buddy: "Anmeldung abgelaufen" with "Neu anmelden", and no broken screen. Tap "Neu anmelden": the Cloudflare login appears. After the PIN the app shows the Start screen.
- [ ] **Expired login with a share.** End the login, then share a PDF to Print Buddy: "Anmeldung abgelaufen". Tap "Neu anmelden", fetch the PIN from the mail app and come back. After the PIN the options screen opens with that PDF, without sharing it again.
- [ ] **Expired login at "Drucken".** Share a PDF, set 2 Kopien and Farbe, then end the login in Chrome and go back to Print Buddy. Tap "Drucken": "Anmeldung abgelaufen", not "Drucken hat nicht geklappt". After the login the options screen shows the same file with 2 Kopien and Farbe. Tap "Drucken": it prints that way.
- [ ] **Expired login on the status screen.** Switch the Printer off and print a PDF, so the job stays on "Wartet". End the login in Chrome and go back to Print Buddy: within a few seconds "Anmeldung abgelaufen". After the login the status screen shows the same "Auftrag Nr.", and "läuft seit" has gone on counting. Tap "Abbrechen".
- [ ] **Left on "Anmeldung abgelaufen".** Bring up "Anmeldung abgelaufen" at "Drucken" once more, close the app instead of logging in and open it again: after the login it shows the Start screen, and the job is gone. This is also what happens if Android closes Print Buddy while the mail app is open for the PIN. If one of the checks above ended on the Start screen for that reason, note the phone: there the person has to share again after a login.

Over plain HTTP on the Household network (`http://<home-assistant-address>:9217`, with the LAN port on) the app can't be installed and has no share target. Check once from a laptop: the Start screen shows only "Datei auswählen", and a picked PDF prints.

### 4. Bypass fallback

Only if step 3 fails, that is Chrome offers no "Installieren" or Print Buddy is missing from the share sheet:

1. Add a second Access application for `print.example.org` with a Bypass policy for everyone, for exactly these paths: `/manifest.webmanifest`, `/sw.js`, `/icon-192.png`, `/icon-512.png` and `/icon-maskable-512.png`.
2. Add a tunnel route for the same paths to the same service, with "Protect with Access" off, and move it above the main route. Without it cloudflared still drops these requests.
3. Remove Print Buddy from the phone and repeat step 3.

Nothing else may be bypassed. These files contain no personal data. `/login` and `/share-target` in particular stay behind the login. "Neu anmelden" loads `/login` so that Cloudflare shows its login there; bypassed, it would send the person straight back to "Anmeldung abgelaufen".

## Releasing

Versions are `YYYY.MM.N`: year, two-digit month, and a counter that starts at 0 each month. The one source is the `version` line in `print-buddy/config.yaml`. The server reads that file, and the release workflow refuses a tag that differs from it.

1. Set the new version in `print-buddy/config.yaml` and add an entry at the top of `print-buddy/CHANGELOG.md`. `pnpm test` checks that the two agree.
2. Commit on a branch and tag that commit `v<version>`, for example `v2026.11.0`. Push the branch and the tag. `.github/workflows/release.yaml` builds the aarch64 image and pushes it to `ghcr.io/kuirak/print-buddy:<version>`.
3. Merge to `main` once the workflow is green. Home Assistant offers the update as soon as `main` holds the new version, so the image has to be there first.
4. Only after the very first release: on GitHub, open the package `print-buddy` > Package settings > Change visibility > Public. GHCR creates it private, and Home Assistant pulls without a login.
5. Update the add-on in Home Assistant, then do the smoke print below.

Never push a different image under a version that already exists.

### Smoke print (every release, by hand)

No test reaches the real Printer, so each release gets one print against the real queue:

1. Open Print Buddy on a phone through `https://print.example.org`.
2. Pick a one-page PDF, tap "Drucken" and confirm "Jetzt drucken?".
3. The app shows the job number, and the page comes out of the Printer.
4. `http://<home-assistant-address>:9217/health` (with the LAN port on) or the add-on log shows the new version.

## Development

Needs Node 26 and pnpm 12. Run `pnpm install` once.

### Commands

| Command | What it does |
|---|---|
| `pnpm test` | All tests: server and shared code under `node --test`, then the UI under vitest. |
| `pnpm typecheck` | Type check of everything (`tsc --noEmit`; nothing is ever emitted). |
| `pnpm dev` | Builds the UI and starts the app on http://localhost:9217 against a fake printer, with a temporary jobs directory. Nothing reaches a real printer. |
| `pnpm test:server`, `pnpm test:ui` | One half of `pnpm test`. A single file: `node --test server/print.test.ts`, `pnpm vitest run src/App.test.tsx`. |
| `pnpm dev:ui` | Vite dev server with hot reload; `/api` is proxied to port 9217, so run `pnpm dev` beside it. |
| `pnpm build` | Copies the files pdf.js fetches while drawing into `ui/public/pdfjs`, builds the UI into `dist/ui`, and after it the service worker `dist/ui/sw.js`. |
| `pnpm start` | Starts the server the way the add-on does (`node server/main.ts`). |

The server reads these environment variables, for tests and local runs only:

| Variable | Default | Meaning |
|---|---|---|
| `PRINT_BUDDY_OPTIONS_FILE` | `/data/options.json` | The add-on options file (`printer_name`, `upload_limit_mb`). A missing key gives the spec's default; a missing `printer_name` stops the start. |
| `PRINT_BUDDY_CUPS` | `172.30.32.1:631` | Host and port of CUPS. The queue address is `ipp://<this>/printers/<printer_name>`. |
| `PRINT_BUDDY_JOBS_DIR` | `/share/print-buddy/jobs` | Where Print Job folders live. Drafts are in `drafts/` below it. |
| `PRINT_BUDDY_PORT` | `9217` | Port to listen on. `0` picks a free one. |

### Layout

One package, no workspaces. Imports between folders are relative and end in `.ts` or `.tsx`.

```
shared/            Pure TypeScript for both sides. No DOM, no node: imports.
  print-options.ts   The Print Options type. The only definition.
  layout.ts          The layout module: where content sits on a sheet, and how many sheets a Print Job takes.
  api.ts             JSON shapes of the HTTP API.
  file-header.ts     What the head of a file says: its type, and a photo's pixel size and EXIF orientation. Intake and the app both read facts with it.
  share-target.ts    The share target's path and names.
  login.ts           The address "Neu anmelden" loads, and the app's address after the login.
  *.test.ts          Seam 2 tests.
server/            Runs as `node server/main.ts`, straight from the sources.
  main.ts            Entry point: reads the config, starts the server.
  config.ts          Add-on options file and environment.
  version.ts         The Print Buddy version, read from print-buddy/config.yaml.
  server.ts          startServer(): listens, runs the cleanup every hour, returns the URL and close().
  app.ts             Wires the modules together and mounts the routes.
  clock.ts           The injectable clock type.
  intake.ts          Upload intake (drafts).
  source-pdf.ts      An uploaded PDF as a reader shows it: which part of a page, turned how, with which form fields and annotations.
  job-store.ts       Job store: job folders, job.json, the 7-day cleanup.
  renderer.ts        Renderer: builds the PDF that goes to CUPS.
  status-mapper.ts   Status mapper: CUPS job facts to a screen state and a German reason.
  printer/           Printer client: client.ts and the IPP codec.
  http/              One file per API resource: drafts, jobs, printer, report, session (with /login), health, share-target, ui (static files).
  testing/           Seam 1 helpers: harness, fake IPP printer, fixtures, and rendered-pdf.ts, which reads a printed PDF back.
  *.test.ts          Seam 1 tests, next to the sources.
ui/                Vite root.
  index.html         The page.
  public/            Served as they are: manifest.webmanifest and the icons. `pdfjs/` is copied in by the build and not in git.
  src/main.tsx       Entry point: mounts App. app.css beside it has the Tailwind setup and the two button classes.
  src/App.tsx        App shell: which screen shows.
  src/api.ts         One function per API operation. The only place that talks to the server: fetch, and XMLHttpRequest for uploads.
  src/upload.ts      The upload of the phone's copy into a draft, with its progress; it runs behind the options screen.
  src/file-facts.ts  The facts of the phone's copy, read in the browser so the options screen needn't wait for the upload.
  src/presets.ts     The Presets: the built-in ones, and the own ones and starred defaults in browser storage.
  src/phone-files.ts The phone's copy of the files of the job in progress.
  src/interrupted-job.ts  What else of a job survives the page load of the login.
  src/share-target.ts  Which requests the service worker answers itself, and what it does with a share.
  src/app-update.ts  When a new version of the installed app may take over.
  src/report.ts      The report builder: the plain text behind "Bericht kopieren".
  src/last-job.ts    The last Print Job from this phone, for the line on Start.
  src/job-text.ts    The German words for the Print Options, as the summary line and the confirmation say them.
  src/state-words.ts The German words for the five states of a Print Job.
  src/pdf-preview.ts The only module that imports pdfjs-dist: opens a PDF, reads its page sizes and draws a page onto a canvas.
  src/sw.ts          The service worker. Built into /sw.js; its logic is in share-target.ts and app-update.ts.
  src/screens/       One screen per file.
  src/controls/      One hand-built control per file: stepper, Position grid, preset chips, preview and so on.
  src/testing/       Seam 3 helpers, and setup.ts, which vitest runs before every test file.
  src/*.test.tsx     Seam 3 tests, all in this one folder.
scripts/dev.ts     What `pnpm dev` runs.
scripts/pdfjs-assets.ts  Runs before every build: copies pdf.js's decoders, fonts and character maps into ui/public/pdfjs.
vite.config.ts     The UI build, the second build for the service worker, and the vitest settings.
print-buddy/       The Home Assistant add-on folder: config.yaml, README.md (the intro in the store), DOCS.md, CHANGELOG.md, translations.
repository.yaml    Makes the repository an add-on repository.
Dockerfile         The add-on image. Built by .github/workflows/release.yaml, never by Home Assistant.
```

Rules that keep parallel work apart:

- One server module per entry in the spec's Modules list. New ones (renderer, status mapper, report builder, the layout module in `shared/`) get their own file. `app.ts` only constructs and mounts them.
- One API resource per file under `server/http/`, mounted with one line in `app.ts`, above the two catch-all lines.
- One screen per file under `ui/src/screens/`. Put each hand-built control (stepper, Position grid, preset chips and so on) in its own file under `ui/src/controls/`.
- `shared/` imports nothing outside `shared/`. `server/` and `ui/` never import each other.
- The server runs through Node's type stripping, so: no `enum`, no constructor parameter properties, `import type` for types, and real file extensions in imports. `pnpm typecheck` rejects all of these.
- `dependencies` holds only what the server imports at run time. Everything the UI uses is a `devDependency`, because Vite bundles it.
- All visible text is German. The wording comes from the spec and the options-screen prototype.

### Tests: the three seams

Tests go through one of three seams and assert on what a user or CUPS would see. They use random ports and temporary directories.

**Seam 1: the HTTP API against a fake IPP printer** (`server/*.test.ts`, `node --test`)

```ts
import assert from "node:assert/strict"
import { test } from "node:test"
import { samplePdf } from "./testing/fixtures.ts"
import { startTestServer } from "./testing/harness.ts"

test("…", async t => {
  const server = await startTestServer()
  t.after(server.close)

  const { draftId } = await (await server.post("/api/drafts")).json()
  await server.upload(draftId, samplePdf(), "a.pdf", "application/pdf")
  await server.submit(draftId, { copies: 2 })

  assert.equal(server.printer.requests.length, 1)
})
```

- `startTestServer(opts)` in `server/testing/harness.ts` starts the real server on a free port. It writes an options file that sets `printer_name` and `PRINT_BUDDY_CUPS` to the fake printer, and uses a temporary directory in place of `/share` and `/data`. `close()` stops everything and deletes the directory.
  - `opts.options`: extra keys for the options file, for example `{ upload_limit_mb: 1 }`.
  - `opts.now`: start time of the fake clock. `opts.ui`: files of a stand-in UI build.
  - `opts.beforeStart(printer)`: runs before the server starts, to script what the fake printer answers to the startup read of the margins.
  - It returns `request(path, init)`, `post(path, json?)`, `submit(draftId, overrides?)`, `upload(draftId, bytes, name, type)`, `print(overrides?, files?)`, `cleanup()`, `restart()`, `url`, `jobsDir`, `clock`, `printer` and `startupRequests`.
  - `submit` posts `samplePrintOptions` from `server/testing/fixtures.ts` (one copy, black and white, A4, page 1), changed by `overrides`. A submit without valid Print Options is a 400.
  - `print` sends a whole Print Job (new draft, one upload per file, submit) and returns `{ jobId, cupsJobId }`. Without `files` it sends `samplePdf()`.
  - `startupRequests` holds the IPP requests the server made while starting. They are taken out of `printer.requests`, so that list starts empty and holds only what the test caused.
  - `cleanup()` does what the server does when it starts and every hour: it deletes old job folders and drafts. Call it after `clock.advance(…)`.
  - `restart()` stops the server and starts it again on the same directories, printer and clock, as a restart of the add-on does. `url` changes with it, so read `server.url` after the restart and don't keep a copy.
- `server.clock` is the server's only source of time: `clock.now()` and `clock.advance(ms)`. Server code takes `now` from its dependencies and never calls `Date.now()` itself. For anything that runs on a schedule, expose a function the test can call after `clock.advance(…)`, instead of faking timers.
- `server.printer` is the fake IPP printer from `server/testing/fake-ipp.ts`. It answers like cupsd 2.4.10.
  - `printer.requests`: every IPP request received, decoded. Read attributes with `values(request, Tag.operation, "requesting-user-name")` or `findAttr(…)` from `server/printer/ipp-codec.ts`. `request.data` holds the document bytes.
  - `printer.jobs`: the jobs by CUPS job number. `printer.setJob(id, JobState.processing, ["job-printing"], "message", ["media-empty-warning"])` scripts a state change; the last argument is `job-printer-state-reasons`.
  - `printer.printer`: the printer's `state`, `reasons` and `message`. `media` lists the entries of `media-col-database` (size and margins in 1/100 mm); `mediaColDatabase = false` leaves the margins out. `failNext = 503` makes the next request fail at HTTP level. `unreachable = true` drops every connection, like a CUPS that is down. `acceptingJobs = false` makes it refuse Print-Job with an IPP error.
  - Cancel-Job from a user who doesn't own the job gets HTTP 401, as with real CUPS.
  - `printer.hold(Op.getJobAttributes)` keeps back the answer to the next request with that operation, for tests where two requests overlap. `arrived` resolves when the request is there, and `release()` sends the answer, which says what was true when the request arrived.
- `server/testing/fixtures.ts` holds small test files. Add new ones there, built in code and without dates or random ids.

**Seam 2: the layout module** (`shared/*.test.ts`, `node --test`)

Pure functions, so there is no helper: import the function and loop over a table of cases with literal expected numbers.

**Seam 3: UI components with the API mocked at `fetch` and `XMLHttpRequest`** (`ui/src/*.test.tsx`, vitest with happy-dom)

```tsx
import { render, screen } from "@solidjs/testing-library"
import { userEvent } from "@testing-library/user-event"
import { expect, test } from "vitest"
import { App } from "./App.tsx"
import { json, mockApi } from "./testing/mock-api.ts"
import { printAndConfirm } from "./testing/options-screen.ts"

test("…", async () => {
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
  })
  const user = userEvent.setup()
  render(() => <App />)

  await printAndConfirm(user)

  expect(await screen.findByText("…")).toBeInTheDocument()
  expect(api.calls[0]!.headers.get("X-Requested-With")).toBe("XMLHttpRequest")
})
```

- `mockApi(routes)` in `ui/src/testing/mock-api.ts` replaces `fetch`, and `XMLHttpRequest` (which the uploads use), with one table keyed `"METHOD /path"`. A handler returns a `Response` (use `json(body, status)`), or a plain value that is sent as JSON with status 200. It may return a promise, to hold an answer back. A handler that throws is a call that got no answer.
- `api.calls` lists every call with `method`, `path`, `headers`, `body` and `signal`, which is aborted when the app stopped the call. `api.on(route, handler)` changes a route while the test runs.
- An upload reports its whole body as sent when its answer arrives. So with two photos of 600 and 400 bytes (`jpegFile(name, w, h, bytes)`) and the second answer held back, Drucken reads "Wird hochgeladen … 60 %".
- A call to a route that isn't in the table rejects, so a forgotten route fails the test. Two routes answer without being in the table, unless it has its own handler for them: `GET /api/session`, which the app asks every time it opens, answers as for a valid login, and `GET /api/printer` answers `printerInfo()` (see below). So `api.calls[0]` of a rendered `<App />` is the session check; find other calls by their path.
- `ui/src/testing/setup.ts` unmounts the rendered app and removes the stubs after each test. It also gives every test an empty phone storage (see the Share-to-print notes below), a stand-in for pdf.js and addresses for photos that name their file (both below).
- Solid 2 applies signal writes in a microtask. `await user.click(…)` is enough to see the result; after `fireEvent` add `await Promise.resolve()`.
- With fake timers use `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })` and `await vi.advanceTimersByTimeAsync(ms)`.
- `ui/src/testing/options-screen.ts` has the taps nearly every test needs: `printAndConfirm(user)` (Drucken, then Drucken in "Jetzt drucken?"), `openDetails(user)` ("Ändern") and `closeDetails(user)` ("Fertig"), and `confirmation()` for the open dialog. A test that expects a Print Job to be sent uses `printAndConfirm`, never a bare tap on Drucken.
- A test that goes on to the status screen needs a `GET /api/jobs/<id>` route. Without one the screen stays on Wartet: a failed poll is tried again and never fails the test. `jobStatus(changes?)` in `ui/src/testing/job-status.ts` builds the answer: job `j1`, CUPS job 42, waiting since `sentAt`.
- **pdf.js is a stubbed boundary, like `fetch`.** happy-dom has no worker and no canvas that draws, so what pdf.js puts on a canvas can't be seen in a test. Never import `pdfjs-dist` in a component: `ui/src/pdf-preview.ts` wraps it, and the setup file replaces that module for every test. The stand-in opens any bytes as a PDF. Its pages have the sizes of the `/MediaBox [0 0 w h]` entries in the bytes, or one A4 page when there are none; `pdfFile(name, pages)` in `ui/src/testing/files.ts` writes them. For each page it is asked to draw it gives an empty canvas that says what was asked: `data-pdf` (the file's bytes as text), `data-page`, and the pixels asked for as the canvas's `width`. Assert on these canvases where they sit on the screen: on what was asked to be drawn and where it shows, never on how often `openPdf` or `renderPage` ran.
- **Files the browser reads.** The options screen opens from the facts the browser reads (see the ticket 18 notes below). A file made with `pdfFile()` or `jpegFile()` opens it before the upload is done. Any other test file (`new File(["\xff\xd8\xff"], …)` is not a JPEG head once encoded) opens it only when the server has answered, from the facts the test's route sends.
- A photo's picture has the address `blob:<file name>`, because the setup file replaces `URL.createObjectURL`, whose own addresses are random. `expect(picture).toHaveAttribute("src", "blob:Strand 1.jpg")` says which photo shows.
- Every options screen reads `GET /api/printer`. `mockApi` answers it with `printerInfo()` from `ui/src/testing/printer-info.ts` unless the table has its own handler, so `api.calls` holds that GET too: filter the calls you assert on. Drucken is unavailable until it has answered.

### The layout module

`layout()` in `shared/layout.ts` decides where every page or photo sits. The renderer and the preview both call it and add no geometry of their own.

```ts
import { layout, SHEET_SIZES } from "../shared/layout.ts"

const sheets = layout({
  source: { kind: "pdf", pages },      // page sizes in points as a reader shows them (the intake's facts)
  // or { kind: "photos", photos }     // per photo: stored pixel width and height, EXIF orientation
  options,                             // the Print Options
  sheet: SHEET_SIZES[options.paper],   // portrait, envelopes too
  margins,                             // the Printer's margins for that paper, in points
})
```

- Everything is in points. `selection` holds PDF page numbers counted from 1, or photo indexes counted from 0. `photoRotations` is keyed by photo index. An entry of `selection` that isn't in the source throws, so check the selection against the draft's files first.
- `source` takes the intake's facts: `PdfFacts` as it is, or `{ kind: "photos", photos }` with the `PhotoFacts` of the draft in order. `margins` is `PrinterInfo.margins[options.paper]`, or `printer.margins()[options.paper]` on the server.
- The result has one entry per sheet, so its length is the sheet count for one copy. `sheetCount(sheets, copies)` is the sheets of paper the whole Print Job takes; the confirmation and the server both count with it. Each sheet has `placements`, `cutOff`, `emptySpace` and `sideways`.
- `cutOff` means content lies outside the printable area, so it is true at Füllen whenever the Printer has margins. `emptySpace` means part of the printable area stays empty. A job is cut off when any sheet is.
- A placement's `left`, `top`, `width` and `height` are its box on the sheet, measured from the sheet's top-left corner. `rotation` is the clockwise turn of the upright content. `scale` × 100 is the effective percentage.
- **Renderer:** write `matrix` as the `cm` operator and draw the page or photo. It maps the content at its natural size, as stored, onto the sheet in PDF coordinates. EXIF orientation and every turn are already in it.
  - An image XObject is a unit square, so scale it by `photoNaturalSize(pixels)` first.
  - A PDF page's own `/Rotate` and CropBox are not in it: `layout()` gets the displayed page size, and the renderer adds the step from the embedded page to the displayed page.
  - Clip each placement to its `clip` box. With two pages per sheet that is the half, and Füllen would otherwise run into the other half.
- **Preview:** draw the upright picture (an `<img>` already shows a photo upright, pdf.js applies `/Rotate`) into the box, turned by `rotation`, clipped to `clip`.
- **Two pages per sheet** is laid out the way CUPS lays out `number-up=2`. The sheet is read in landscape and split into a left and a right half. On a portrait sheet (all four papers) the pages therefore lie turned 90° clockwise, page 1 in the top half, and the sheet says `sideways: true`. The preview should show such a sheet turned 90° counter-clockwise. Photos always get one sheet each.

### Notes from the first build

- **IPP library check (spec, "first build must confirm").** `@sealsystems/ipp` 2.11.0 can't send the PPD keywords. A Print-Job serialized with `copies`, `ColorMode`, `Quality`, `MediaType` and `PageSize` contains `copies` and none of the other four: the library drops attribute names it doesn't know, without an error. So the spec's fallback applies. The Printer client (`server/printer/`) is a small hand-written IPP client, and `@sealsystems/ipp` is not a dependency. Its codec was checked against a real cupsd 2.4.10. PPD keywords go out as `nameWithoutLanguage` values (`v.name(…)`), the way `lp -o` sends them.
- **Solid Testing Library and Solid 2.** `@solidjs/testing-library` supports Solid 2 only from its `next` tag. Version `1.0.0-rc.2` is pinned and works, so Seam 3 uses it and not Solid's own render utilities. The `latest` tag (0.8.x) is for Solid 1.
- **Solid 2 packages.** The DOM runtime is `@solidjs/web` and the Vite plugin is `@solidjs/vite-plugin`. `vite-plugin-solid` and `solid-js/web` are for Solid 1. Read `node_modules/solid-js/CHEATSHEET.md` before writing a component.
- **Dependencies.** The library list of the spec is installed and all of it is in use: `@cantoo/pdf-lib` and `exifr` on the server, `pdfjs-dist` in the UI. No ticket needed another one.
- **Health path.** The health endpoint is `/health`, outside `/api`, for the HA watchdog. It never contacts CUPS.
- **Version.** `import { version } from "./version.ts"` in the server gives the Print Buddy version. It is read from `print-buddy/config.yaml`, the one source. `/health` answers `{ ok: true, version }`. Don't add a version to `package.json`.
- **Packaging.** The image holds `server/`, `shared/`, `dist/`, the production `node_modules` and `print-buddy/config.yaml`. A new top-level folder the server needs at run time must be added to the `Dockerfile`. Home Assistant treats every file named `config.yaml`, `config.yml` or `config.json` in a non-hidden folder as an add-on, so never add another file with one of these names. Try the image with `docker build --platform linux/arm64 -t print-buddy:dev .` and `docker run --rm -p 9217:9217 -v "$PWD/data:/data" print-buddy:dev`, with an `options.json` in `data/`.
- **Shutdown.** `server/main.ts` closes the server on SIGTERM and SIGINT, because node is PID 1 in the add-on (`init: false`). Anything that must finish before the process ends belongs in the server's `close()`.

### Print Options and printer info

- **Submit.** The body of `POST /api/drafts/:draftId/submit` is the Print Options object itself (`SubmitRequest` in `shared/api.ts`). `parsePrintOptions` in `shared/print-options.ts` checks all of it; anything invalid is a 400 `{ error: "invalid-options" }` and nothing is sent to CUPS. It doesn't check `selection` against the draft's files: the renderer does, with the same answer (see the renderer notes below).
- **What CUPS gets.** `printer.printJob(pdf, options)` sends only `copies`, collated copies, `ColorMode`, `PageSize`, `Quality` and `MediaType`. Our paper names are the PPD's `PageSize` names. Everything else in the Print Options has to be drawn into the PDF.
- **Printable margins.** `GET /api/printer` answers `PrinterInfo`: `margins` per paper plus the printer's `state`, `reasons` and `message`. Margins are in points, for the sheet in portrait, as `{ top, right, bottom, left }`. On the server the same values come from `printer.margins()`. They are read once, while the server starts; a paper CUPS doesn't report gets 9 pt left and right, 12 pt top and bottom, with one warning in the log. When CUPS doesn't answer the state read, `state` is `unknown` and the margins are still there.
- **Options screen.** `OptionsScreen` owns the Print Options in a store and hands them to `onPrint`. A new file starts from the default Preset of its file type (see Presets below) with everything selected: `selection` is every page of the PDF or every photo, from the `facts` prop. Kopien, Farbe, Papier, Qualität and Seiten pro Blatt are behind "Ändern" (see the summary line notes below). `ui/src/controls/` has `Stepper` and `ChoiceGroup` (a `radiogroup` of buttons); tests find them by role and German name.

### Presets

- **Where.** `ui/src/presets.ts` has the built-in Presets, the `PresetValues` type (the seven fields a Preset stores) and `createPresets(kind)`, which reads and writes browser storage. `PresetChips` and `PresetActions` under `ui/src/controls/` are the two parts on the screen. Both take the Print Options and call `onPick`; `OptionsScreen` applies the Preset to its store.
- **A new field in the Print Options.** If a Preset should store it, add it to `PresetValues`, to `sameValues` and to `save` in `presets.ts`, and to the built-ins. Print size, Position and pages per sheet are already stored and compared, so their controls only have to write the Print Options store. `rotation`, `selection` and `photoRotations` belong to the file and are never touched by a Preset.
- **File type.** `OptionsScreen` takes `kind: FileKind`, which is `"pdf" | "photo"` (`shared/api.ts`). `fileKind(facts)` in `presets.ts` is the one place that decides it: the `kind` the server found for the first file of the Print Job, because a draft never mixes the two. `App` calls it. The kind picks the chips, the default Preset and which star is set. It is read once: a new file gets a new `OptionsScreen`.
- **Starting options.** A new file starts from the starred Preset of its type plus `rotation: 0` and every page or photo selected. Nothing from a Print Job is written to storage, so the next file can't inherit it.
- **Which chip is marked.** The Preset whose seven fields all equal the Print Options. If several are equal, the one tapped or saved last, else the first in chip order. If none, the last chip reads "✎ Eigene"; otherwise it reads "Eigene …". Tapping that chip opens the detailed controls, where the Preset actions are too.
- **Chips per type.** PDFs get Dokument Farbe (the built-in default), Dokument s/w and Umschlag DL; photos get Foto and Foto s/w Toner sparen. An own Preset belongs to the file type it was saved for.
- **Storage.** One `localStorage` key, `print-buddy.presets`: `{ own: Preset[], defaults: { pdf?: id, photo?: id } }`. Entries that don't pass `parsePrintOptions` are dropped on load. A starred id that no longer exists falls back to the built-in default. The Seam 3 setup file clears `localStorage` after each test; a test "reopens the app" with `cleanup()` and a second render.
- **Tests.** In `ui/src/presets.test.tsx` the chips are the `radiogroup` named "Voreinstellung". Saving and deleting ask on the screen itself (a name field, "Voreinstellung löschen?"), not with `window.prompt` or `window.confirm`.

### Notes from upload intake (ticket 03)

- **File facts.** `FileFacts` in `shared/api.ts` is what the layout module and the renderer start from. For a PDF: `pageCount` and `pages[]`, each the size a reader shows, in points: the part of the CropBox that lies on the page, with `/Rotate` applied. `shownPart()` in `server/source-pdf.ts` decides that part and the turn by the rules of pdf.js, for intake and for the renderer. For a photo: `format`, the stored pixel `width` and `height`, and the EXIF `orientation` (1 to 8, 1 when there is none). The pixel size is not turned: for orientations 5 to 8 the upright photo is `height` × `width`.
- **Refusals.** A refused upload answers `{ refusal }` (type `Refusal`) with status 413 (`too-large`, which also carries `limitMb`), 415 (`unsupported-type`) or 409 (the other three). The draft stays as it was. In the app, `addFile()` resolves with the facts or the Refusal and throws only for other failures; it takes a signal that stops it and an `onProgress` callback. The German texts are in `ui/src/screens/RefusalScreen.tsx`.
- **Upload limit.** `hono/body-limit` counts the bytes as they arrive and answers 413 at `upload_limit_mb` plus 64 kB of multipart overhead, so an oversized file is never held. A file within the limit is read into memory once (at most `upload_limit_mb`), as the stack exploration recommended; there is no streaming to disk and no `busboy`.
- **Drafts on disk.** A draft's files are `drafts/<draft-id>/<n>.pdf|jpg|png`, numbered in upload order. `intake.files(draftId)` gives the path and the facts of each.
- **In the app.** The options screen state holds `files` (the phone's copy, in shared or picked order), `facts` (same order; the browser's, see the ticket 18 notes) and the running `upload`. `ui/src/controls/FilePicker.tsx` is the one "Datei auswählen"; the start and Refusal screens share it.
- **Fixtures.** `server/testing/fixtures.ts` has `pdfWithPages()` (sizes, `/Rotate`, CropBox, form fields and annotations), `sampleJpeg()` (40×30), `withExifOrientation()`, `samplePng(w, h)` and `encryptedPdf()`. Make test files different in size, so a test can tell them apart in a rendered PDF.

### Notes from the status screen (ticket 05)

- **Reading a Print Job.** `GET /api/jobs/:jobId` answers `JobStatus` (`shared/api.ts`): `state`, `reason`, `details`, `cupsJobId`, `sentAt`, `endedAt` and `sheets`, and for the report `file` and `options` (see the report notes below). `state` is a `ScreenState` key (`waiting`, `printing`, `done`, `cancelled`, `error`); the German words are in `ui/src/state-words.ts`. `reason` is a German sentence, or null when there is nothing to explain. `details` is what CUPS said: `jobState` as the IPP keyword, `jobStateReasons`, `printerStateReasons` (`job-printer-state-reasons`) and `printerMessage` (`job-printer-state-message`).
- **Each read asks CUPS** with Get-Job-Attributes, until the job has ended. The first read that sees the end sets `endedAt` from the server's clock, so it can be up to one poll late. After that the stored state is answered and CUPS is not asked again. When CUPS can't answer, or no longer knows the job, the read answers the last state seen, with a warning in the log. A read looks at the record again once CUPS has answered: if a cancel or another read saw the job end in the meantime, that stands and the late answer is dropped.
- **Status mapper.** `mapStatus(details, cancelledByPrintBuddy)` in `server/status-mapper.ts` is the one place that decides state and reason. A `processing` job whose printer message says the Printer isn't connected yet (`notConnectedMessages`) is Wartet, and `processing-stopped` is Wartet too. The reasons are described under "Notes from failures" below.
- **Cancel.** `POST /api/jobs/:jobId/cancel` answers the new `JobStatus`, or 409 `{ error: "not-cancellable" }`. It is allowed exactly while the job reads as Wartet. The job store's `cancelled` flag records Print Buddy's own cancel, because CUPS marks every cancelled job the same way. The flag is set before CUPS is asked and taken back when CUPS refuses, so a status read that overlaps the cancel never takes it for somebody else's. `printer.cancelJob()` resolves false when CUPS refuses (`IppRefusal`: a bare HTTP status or an IPP error status) and throws only when CUPS can't be reached.
- **Sheet count.** `sheets` is set at submit: `sheetCount()` of the layout module, which is the number of sheets in the rendered PDF times `copies`. So it follows `selection` and `pagesPerSheet`.
- **Job store.** `await jobs.update(job, changes)` gives the changed record; records are never changed in place. The changes go onto the record as the store holds it now, so an older copy in the caller's hand can't bring old values back. `details`, `endedAt` and `cancelled` are the fields that change after `add`.
- **Status screen.** It assumes Wartet until the first answer. It polls with a timeout chain, 2 s after each answer, and stops once `endedAt` is set. The running timer counts from when the screen opened, on the phone's clock; "gedauert" is `endedAt - sentAt` from the server. The 60 s hint shows while the state is Wartet and the timer is at 60 s or more. Every ended state offers "Schließen" and "Nochmal drucken". `reason` is shown in every state that has one.
- **Nochmal drucken.** The status screen state in `App.tsx` keeps `options`. `print(options)` without a draft id uploads the phone's copy into a new draft and submits it with the same Print Options, without going back to the options screen.

### Notes from failures (ticket 06)

- **Reasons.** `reasonTexts` in `server/status-mapper.ts` maps reason keywords to German sentences. The mapper looks through the job's reasons, then the Printer's, and takes the first keyword it knows, with a trailing `-report`, `-warning` or `-error` removed. After that it checks the backend message (`messageTexts`). To teach it a new reason, add a line to one of the two tables and a case to the table test in `server/status.test.ts`.
- **Which states have a reason.** Fehler always has one: the known reason, or "Beim Drucken ist ein Fehler aufgetreten.", or the sentence for a job somebody else cancelled. Wartet and Wird gedruckt have one only when CUPS names a known reason. Fertig and Abgebrochen have none.
- **Fehler on the status screen.** It adds "Details" (`ui/src/controls/Collapsible.tsx`, a button with `aria-expanded`; the content is in the page only while open).
- **A submit that can't be sent.** `POST /api/drafts/:draftId/submit` answers `SubmitFailure` (`shared/api.ts`): 502 `cups-unreachable` or `cups-rejected`, 500 `render-failed`. No Print Job is created and the draft stays, so the same submit can be repeated. The cause goes to the server log. Once CUPS has accepted the job, the answer is always the Print Job (see the job folder notes below).
- **"Drucken hat nicht geklappt".** Anything that throws inside `print()` in `App.tsx` (upload or submit, an error status or no network) leads to `SendFailedScreen`. Its screen state keeps `options`. "Erneut versuchen" calls `print(options)` without a draft id, so the phone's copy is uploaded into a new draft, as with "Nochmal drucken". A screen that must come before it for one kind of failure (the expired login) has to catch that failure first.

### Notes from the renderer (ticket 07)

- **What CUPS receives.** Submit calls `render(files, options, margins)` in `server/renderer.ts` and sends its PDF, never an uploaded file. The result also has `sheets`, the sheets of paper the job takes, copies included. Photo drafts print: all photos of a draft are one PDF and one Print Job.
- **Form fields and annotations.** pdf-lib embeds only a page's content, so `drawAnnotations()` in `server/source-pdf.ts` first draws them into the page: each one's normal appearance, fitted to its rectangle, if it is flagged for printing and not hidden. The preview asks pdf.js for the same set. Ticket 07's comments list the details and the one limit left.
- **Print Options that don't fit the draft** are a 400 `{ error: "invalid-options" }`, the same answer as for malformed ones: an empty `selection`, a page number outside 1 to the page count, a photo index outside 0 to the photo count minus 1, or `pagesPerSheet: 2` for photos. The app never submits an empty selection: Drucken is unavailable then (see the thumbnail notes below).
- **Test options.** `samplePrintOptions` selects page 1, which is also valid for a draft of two or more photos (photo index 1) but not for a single photo: pass `{ selection: [0] }` there.
- **Reading the printed PDF in a test.** `readRenderedPdf(request.data)` in `server/testing/rendered-pdf.ts` gives the sheets with their size and items. Each item has `kind`, `size` (to tell fixtures apart: the size of the embedded part of the page before `/Rotate`, or the photo's pixels), `box` and `clip` on the sheet measured from the top-left corner, and `corners`, which show rotation and mirroring. A page with form fields or annotations drawn into it also has `annotations`: the rectangle each takes up on the source page, and the content stream of its appearance. Numbers are rounded to 0.01 pt. `server/render.test.ts` sets the fake printer's margins to zero where that keeps the expected numbers simple.
- **Fixtures.** Pages of `pdfWithPages()` have a content stream, because pdf-lib can't embed a page without one. `{ blank: true }` makes a page without `/Contents`; it prints as an empty sheet unless an annotation is drawn on it. `annotations` puts form fields and annotations on a page, each with its dictionary entries as text and its appearance. `pdfWithPages(pages, { needAppearances: true })` sets the form's `/NeedAppearances`.
- **Margins in tests.** The printer client rounds margins to 0.01 pt (9.01 and 11.99 pt for the fake printer), and the renderer uses exactly those, like the preview does through `GET /api/printer`.
- **PNG memory.** Photos are embedded one after the other, and each selected photo once. pdf-lib unpacks a PNG to raw pixels (about 360 MB for 4000×3000 on a Mac), so a large PNG batch is slow on the Pi; not measured there.

### Notes from the preview (ticket 08)

- **One layout for the whole screen.** `OptionsScreen` reads the margins with `readPrinter()`, again every 2 s for as long as that read fails, and calls `layout()` in one memo, `sheets`. The preview, the percentage in the Print size row and the cut-off warning all read that memo; none of them computes a size or a place. Until the margins are there nothing is laid out: the paper is empty, Drehen and Drucken are off and the − / + buttons are left out.
- **The preview** is `ui/src/controls/Preview.tsx`. It gets one `Sheet` of the layout module, the paper size and the margins, and only turns points into percent of the sheet: for each placement the `clip` box, in it the placement's box, in it the upright picture turned by `rotation`. It draws every placement of the sheet, so two pages per sheet show as the layout module puts them. A `sideways` sheet is shown turned 90° counter-clockwise, edge and all.
- **Which sheet.** `shown()` in `OptionsScreen` is the sheet the person stepped to (see the thumbnail notes below). Drehen turns the whole PDF, or the photo of the first placement of the shown sheet (`photoRotations`).
- **The pictures.** For a PDF, `openPdf(bytes)` in `ui/src/pdf-preview.ts` gives `renderPage(pageNumber, longSide)`, a canvas with the page as a reader prints it. pdf.js draws with `intent: "print"`, so a form field or an annotation shows exactly when the server's renderer draws it too. For photos the preview shows the phone's copies (`files` prop) through object URLs, which the screen revokes when it goes; an `<img>` applies the EXIF orientation itself. Thumbnails can use the same two sources.
- **Black and white, paper, edge.** Black and white is a CSS `grayscale` filter on the picture. The sheet has the paper's aspect ratio and always fills the same panel, so A4 and A5 look alike except for the wider edge. The unprintable edge is a dashed frame at the margins with a pale veil outside it; content under the veil or beyond the paper is what the warning is about.
- **Ansicht** (`ViewZoom`) is 100, 150, 200 or 300 %, on the screen only; the panel then scrolls in both directions. A PDF page is drawn again with more pixels (long side 1500 px × zoom, at most 3000).
- **Print size row** (`PrintSize`). − and + move in steps of 5 from the percentage shown and switch to a percentage; the range is 10 to 400 %, taken from the prototype. `100 %` is marked only at exactly 100.
- **Files pdf.js fetches.** `scripts/pdfjs-assets.ts` copies `wasm`, `standard_fonts`, `cmaps` and `iccs` from `node_modules/pdfjs-dist` into `ui/public/pdfjs` (4 MB, not in git), and Vite takes them into `dist/ui/pdfjs`. pdf.js fetches one from `/pdfjs/…` only when a PDF needs it: a scanned page (JBIG2, JPEG 2000), a font that isn't embedded. They are not in the service worker's app shell and always come from the server. The pdf.js worker is a file under `/assets` and is in the shell. `pnpm build`, `pnpm dev` and `pnpm dev:ui` run the script first; a bare `vite build` leaves them out. The Dockerfile runs `pnpm run build`.
- **Tests.** The stand-in for `pdf-preview.ts` is described under Seam 3 above. Tests don't assert on styling, so grey, the paper's shape and the edge are not covered by them.
- **Checked by hand in Chromium on localhost** (412 × 915, fake printer): a US Letter PDF and a landscape photo, with and without EXIF orientation 6. Grey and colour, A4, A5 and both envelopes, Füllen and 100 % with the warning and the cut content, all turns, Position, the edge at every zoom step, sharp small text at 300 %, and a PDF with Symbol and ZapfDingbats, which fetched its fonts from `/pdfjs/standard_fonts/`.

### Notes from thumbnails and sheet stepping (ticket 09)

- **Selection.** `OptionsScreen` starts with every page or photo selected and `toggle(ref)` is the one place that changes a single entry. `selection` is always in the file's order: a page brought back goes to its place, never to the end. Nothing reorders photos.
- **Thumbnails** (`ui/src/controls/Thumbnails.tsx`) are the `group` named "Seiten" or "Fotos". Each is a button named "Seite 2" or "Foto 2" with `aria-pressed`; its picture is decoration. "Alle" and "Keine" sit below. A thumbnail shows the page or photo upright as it is in the file, in grey when black and white is chosen; it doesn't follow rotation, Print size or paper.
- **Pictures.** `ui/src/controls/PdfPage.tsx` draws one PDF page through pdf.js, for the preview (`fit="fill"`, with a label) and for the thumbnails (`fit="contain"`, 176 px). All thumbnails of a PDF are drawn when it opens, one request per page, not only the visible ones. Photo thumbnails are the same object URLs as the preview.
- **Stepping.** `SheetSteps` shows "‹ Seite 3 · 2/4 ›": the page on the sheet, then which sheet of how many, for one copy. The second number is the sheet count of the selection. With two pages per sheet it reads "Seiten 3 und 4 · 2/2", for photos "Foto 2/3". It is the `status` named "Blatt in der Vorschau"; the buttons are "Vorheriges Blatt" and "Nächstes Blatt". The step is kept past the end and clamped when read (`current()`), so leaving out the last page shows the sheet before it. Bringing a page back shows its sheet; "Alle" and "Keine" go to the first.
- **Nothing selected.** The status reads "Keine Seiten ausgewählt" or "Keine Fotos ausgewählt", and the Drucken button is disabled and reads "Keine Seiten gewählt" or "Keine Fotos gewählt". A test that looks for the button named "Drucken" won't find it then.
- **Seiten pro Blatt** is a row with `1` and `2`, for PDFs only. `ChoiceGroup` takes numbers as values now.
- **Tests.** `ui/src/thumbnails.test.tsx`. pdf.js draws the thumbnails too. A test tells the canvases apart by where they sit (inside a thumbnail's button, or inside the preview) and by their width (thumbnails 176, the preview 1500 and more).
- **Checked by hand in Chromium on localhost** (412 × 915, fake printer), with a five-page A4 PDF and three PNG photos (two landscape, one portrait): thumbnails with their numbers, a left-out one pale with a grey number, stepping to both ends, two pages per sheet shown side by side on a landscape sheet, Drehen on that sheet, "Keine" and "Alle", Drehen on the second photo only, and leaving out the first photo. The job folders held `selection: [1,3,4,5]` with `pagesPerSheet: 2` and 2 sheets, and `selection: [1,2]` with `photoRotations: {"1":90}`.

### Notes from the summary line and the confirmation (ticket 11)

- **What is on the options screen now**, top to bottom: "‹ Zurück" with the file name, Preset chips, preview, Print size beside the Position grid (ticket 18), thumbnails (not for a single page or photo, ticket 19), summary line with "Ändern", Drucken.
- **Detailed controls.** `OptionsDrawer` (`ui/src/controls/`) is a sheet at the bottom edge, the dialog named "Einstellungen": Kopien, Farbe, Papier, Qualität, Seiten pro Blatt (PDFs only), the Preset actions and "Fertig". "Ändern" and the last Preset chip open it. Every change applies at once and the preview behind follows; there is nothing to undo. A new option that is not on the spec's list for the screen goes in here as one more row.
- **Summary line.** `SummaryLine` is the `status` named "Gewählte Einstellungen", for example `2× · S/W · A4 · Normal · Einpassen (97 %) · Mitte · 2 Seiten pro Blatt · Seiten 1, 3-5`. Photos have no pages per sheet. The last part says which pages or photos print: "alle 6 Seiten", "Seiten 1-3, 5", "2 von 3 Fotos", "keine Seiten".
- **Confirmation.** Drucken on the screen only opens `Confirmation`, the dialog named "Jetzt drucken?"; its own Drucken calls `onPrint`, and "Abbrechen" closes it with the Print Options untouched. It stays open while the job is sent; `print()` in `App.tsx` still ignores a second tap. First line: `4 Seiten (1, 3-5; 2 pro Blatt) × 2 Kopien = 4 Blätter` or `2 Fotos × 3 Kopien = 6 Blätter`; the page ranges show only when pages are left out. Second line: `Schwarz-Weiß · A4 · Füllen (104 %)`, with ` · Toner sparen` when chosen. Then `⚠ Teile des Inhalts werden abgeschnitten.` when any sheet is cut off.
- **Nothing is computed there.** The sheet count is `sheetCount()` of the layout module over the screen's one `sheets` memo and the copies, the percentage is the one the Print size row shows, and the warning is the same flag. The server's `sheets` is the same function over the same layout, so the two can't differ. `shared/layout.test.ts` has the function's cases, and `ui/src/confirmation.test.tsx` uses the cases of the sheet count test in `server/status.test.ts`. Drucken on the screen is unavailable until the margins have arrived, so the confirmation always has its numbers.
- **Words.** `ui/src/job-text.ts` has the names of papers, qualities and Positions, `ranges()` ("1-3, 5"), `counted()` ("1 Seite", "3 Seiten") and `printSizeText()`. The drawer, the Position grid, the summary line and the confirmation all take them from there.
- **Dialogs.** `Dialog` in `ui/src/controls/` is the dimmed backdrop with a panel, in the middle or at the bottom edge. A tap beside the panel and Escape close it, and it takes the focus when it opens. Whoever opens one makes the screen behind `inert`: `OptionsScreen` keeps which one is open in `over` and sets `inert` on its `<main>`. Testing Library still finds what is behind an open dialog, so a test must not tap it; search inside the dialog with `within(confirmation())` where a name is on both (Drucken).
- **Not built:** "Drucken (n Kopien)" on the button, which the prototype had. The copies are in the summary line right above it and in the confirmation.
- **Checked by hand in Chromium on localhost** (412 × 915, built app, fake printer). A five-page PDF: summary line, "Ändern", two copies and two pages per sheet, "Fertig", page 2 left out, Füllen; the confirmation read `4 Seiten (1, 3-5; 2 pro Blatt) × 2 Kopien = 4 Blätter`, `Schwarz-Weiß · A4 · Füllen (71 %)` and the warning; "Abbrechen" left the summary line and the sheet in the preview as they were; after confirming the server reported 4 sheets. Three PNG photos: the "Eigene …" chip opened the detailed controls, Escape closed them, two copies on A5 with photo 2 left out read `2 Fotos × 2 Kopien = 4 Blätter`, and the server reported 4 sheets. The screen behind an open dialog was inert and the dialog had the focus.

### Notes from job folders and cleanup (ticket 12)

- **Job folder.** `<jobs dir>/<date>_<job-id>/` holds `upload-1.pdf` (or `upload-1.jpg`, `upload-2.png`, … in upload order), `print.pdf` and `job.json`. The date is the UTC day the job was sent. No file carries the name it had on the phone.
- **`print.pdf` is what CUPS got.** Submit in `server/http/drafts.ts` holds the rendered bytes in one variable, `pdf`, and passes it to both `printer.printJob(pdf, options)` and `jobs.add({ …, pdf })`. Keep it that way, so the folder can't hold something else than what was printed.
- **Submit uses up the draft.** After CUPS accepted the job, `jobs.add` moves the uploads into the job folder and `intake.discard(draftId)` forgets the draft. A second submit of that draft is a 404. A submit that failed leaves the draft as it was (ticket 06). To print again, upload into a new draft, as "Nochmal drucken" does.
- **After CUPS has accepted the job, submit answers with the Print Job whatever else fails.** A job folder that can't be filled, a `job.json` that can't be written and a draft that can't be deleted are logged and not thrown. The job's status stays readable from memory until the server restarts. A 5xx at that point would offer "Erneut versuchen", and the job would print twice.
- **`job.json`** is the `PrintJob` record of `server/job-store.ts`: `id`, `cupsJobId`, `sentAt`, `endedAt`, `sheets`, `file` (type, size and page or photo count of what was uploaded), `options` (the Print Options), `details` (what CUPS last said) and `cancelled`. The two times are ISO 8601 text in the file and ms numbers in the record. A new field of `PrintJob` lands in the file by itself; it must never be a name of a person, an email or a file name.
- **When it is written.** At submit, and whenever `jobs.update` changes something. A status read that learns nothing new writes nothing.
- **After a restart.** `openJobStore` reads every `job.json` back, so `GET /api/jobs/:jobId` works as before and goes on asking CUPS. A folder whose `job.json` can't be read is skipped with a warning. Drafts are not read back: the list of drafts is in memory.
- **Cleanup.** `startServer` runs it once before it listens and then every hour; `RunningServer.cleanup()` is the same function. It has two parts, each in the module that owns the folders:
  - `jobs.cleanup()` deletes job folders more than 7 days after `sentAt`. A folder without a readable `job.json` counts from the end of the day in its name.
  - `intake.cleanup()` deletes drafts more than 1 hour after they were created, and every draft folder that has no draft. That covers what an earlier run of the server left behind: nobody can submit those any more.
  - Both only look at entries named like their own folders (`<date>_<uuid>` in the jobs directory, `<uuid>` in `drafts/`). Anything else a person puts there stays.

### Notes from Share-to-print (ticket 14)

- **The phone's copy.** `phoneFiles` in `ui/src/phone-files.ts` is the one place where the files of the job in progress are kept: `keep(files)`, `held()` and `clear()`. It is one record in IndexedDB (database `print-buddy`, store `phone-files`), so it is still there after a full page load, and it works over plain HTTP too. The service worker puts a share there and `pick()` puts picked files there. `beginUpload()` in `App.tsx` starts every upload: a share, "Datei auswählen", "Nochmal drucken" and "Erneut versuchen" all upload what the store holds. No screen state carries files from screen to screen, except the options screen, which shows them.
- **When the copy goes.** `leaveJob()` in `App.tsx` clears it: on "Schließen", and when an upload finds the store empty. A Refusal clears it, because nothing prints. Opening the app without a share clears it, because no job is in progress then. "Drucken hat nicht geklappt" keeps it until "Schließen".
- **The way of a share.** The manifest (`ui/public/manifest.webmanifest`) tells Android to POST to `/share-target`. The service worker answers that POST itself with `receiveShare()` (`ui/src/share-target.ts`): files into the store, then a 303 to `/?shared=1`. `App` sees `shared` in its address, shows `OpeningScreen`, removes the parameter and calls `openHeld()`. The path, the form field and the parameter are constants in `shared/share-target.ts`; a test keeps the manifest equal to them.
- **A share without files** (a known Chrome bug, or a body Chrome can't read) ends on "Bitte nochmal teilen" (see the expired-login notes below).
- **`/share-target` on the server** answers every method with a 303 to `/?shared=lost` and keeps nothing. It is reached when no service worker took the share, and when the browser comes back to that address from the Cloudflare login (see the expired-login notes below).
- **Service worker.** `ui/src/sw.ts` is built by the `serviceWorker()` plugin in `vite.config.ts`: a second build, after the app, into one self-contained `/sw.js`. The plugin fills in `__APP_SHELL__`: the list of files the app build wrote (the page and everything under `/assets`) and a hash over their contents. `handledBy(request)` decides who answers: `share`, `shell` (from the cache `print-buddy-shell-<hash>`) or `network`. Only `/` and `/assets/*` ever come from the cache; API calls, `/login`, `/sw.js`, the manifest and the icons always go to the server. A file that is loaded later (the pdf.js worker) is in the shell as long as Vite emits it under `/assets`.
- **Updates.** A changed `/sw.js` is installed in the background and waits. `startAppUpdate()` in `ui/src/app-update.ts` tells it to take over only while no job is in progress: when the app opens on Start, when the new version finishes installing while Start shows, and from `leaveJob()`. `App` reports the job with `update.setJobInProgress()`. The worker takes over only if this window is the only one open; otherwise it waits until all are closed. After the take-over the page reloads once, unless a job has begun in the meantime.
- **Start screen.** `canReceiveShares` is true where the browser has a service worker. Over plain HTTP it is false and the share hint is not shown.
- **New ways in and out.** Every new way out of a job has to call `leaveJob()`, and every new way in has to go through `phoneFiles.keep()` and `openHeld()`.
- **Until the options screen opens with a share,** `OpeningScreen` shows the app's name and "Wird geladen …": while the browser reads the files, or, for a file it can't read, until the server has it.
- **Tests.** `share(files)` in `ui/src/testing/share.ts` sends the request the manifest declares through `receiveShare()` and follows the redirect; render `<App />` after it. `fakeServiceWorker()` in `ui/src/testing/fake-service-worker.ts` stands in for `navigator.serviceWorker`: `newVersionInstalled()`, `takeOver()`, and `messages` for what the app told the waiting version. Without it a test runs as over plain HTTP. `ui/src/testing/fake-indexeddb.ts` is the phone's storage; it keeps values as they are, so an uploaded file is the same object as the picked one. Assert on the phone's copy with `phoneFiles.held()`.
- **Icons.** `ui/public/icon.svg` and `icon-maskable.svg` are the sources. The PNGs are made with `rsvg-convert -w 512 -h 512 icon.svg -o icon-512.png` (192 for the small one). Never rename the manifest, `/sw.js` or an icon: Android keeps the addresses of an installed app, and the Bypass fallback lists them.
- **Checked by hand in Chromium on localhost**, with a form that posts files to `/share-target` in place of Android: the service worker registers, answers the share without the network and the app opens the options screen; a new build waits during a job and takes over on Start; over `http://<LAN address>` there is no service worker and no error. Chromium rejects `formData()` on an empty multipart body, which happy-dom does not. The install and the share sheet themselves are only in the on-device checks above.

### Notes from the report and the last job (ticket 13)

- **Report builder.** `ui/src/report.ts`. `buildReport(input)` is a pure function that makes the text; `copyReport(subject)` reads what it needs and writes the clipboard. A `ReportSubject` is either `{ job }` (the two numbers from submit) or `{ happened, files, options? }` for a report without a Print Job. `happened` is one German sentence; `files` is a function, called when the report is made.
- **Where the facts come from.** For a Print Job everything is read from the server when the button is tapped: `GET /api/jobs/:jobId` (which asks CUPS, so the state is live) and `GET /api/report` (`ReportFacts`: the Print Buddy version and the Printer's state now). `JobStatus` carries `file` (`kind`, `bytes`, `count`: pages of the PDF or photos in the job) and `options` for this; both are stored in `job.json` at submit. A server that doesn't answer doesn't stop the report: it then says "unbekannt (Server nicht erreichbar)".
- **No file name.** The server never keeps one. Of the phone's files the builder reads only `type` and `size`. A new line in the report must not come from a `File`'s name, from file contents or from an error message the browser made up. The Print Options are written with their keys as they are in `shared/print-options.ts`, so a new option shows up by itself.
- **The button.** `<ReportButton subject={…} />` in `ui/src/controls/`. It says "Kopiert", or "Kopieren hat nicht geklappt" when the browser refuses the clipboard, in an element with role `status`. A new screen where something can go wrong adds this one line with a `{ happened, files }` subject.
- **Send failures.** The `send-failed` screen state keeps what `print()` caught as `error`; `sendFailure(error)` in `report.ts` turns it into the sentence. The Refusal screen state keeps the refused `file`, because the phone's copy is cleared on a Refusal.
- **Last job.** `lastJob` in `ui/src/last-job.ts` keeps `{ jobId, cupsJobId }` of the last submit in `localStorage` under `print-buddy.last-job`; `print()` in `App.tsx` writes it. `LastJobLine` (in `controls/`, shown by `StartScreen`) reads the job once when Start shows: "Letzter Druck: {Zustand}" with the report button. A 404 (the job folder is gone after 7 days) forgets the job; any other failure shows "Letzter Druck: unbekannt" and still offers the report.
- **Tests.** `ui/src/report.test.tsx`. `userEvent.setup()` puts a working clipboard on `navigator`, so a test reads the report with `navigator.clipboard.readText()`. A test that taps "Bericht kopieren" needs a `GET /api/report` route, or the report says the server was not reachable. A test that goes back to Start after a Print Job causes one more `GET /api/jobs/<id>`.
- **Who printed.** `server/report.test.ts` sends the Cloudflare Access headers with every request of a Print Job and checks that nothing of them reaches CUPS, the job folder, the answers or the log. Never read `Cf-Access-*` headers or the `CF_Authorization` cookie into anything that is stored or logged.
- **Not checked on a phone:** that Chrome on Android lets the app write the clipboard after the two reads (it does so for a focused page; the reads take a moment when CUPS is silent).

### Notes from the expired login (ticket 15)

- **Where a 401 is noticed.** In `call()` and `upload()` in `ui/src/api.ts`, for every API call, whoever makes it. It tells the listener `App` set with `onLoginExpired()` and then fails as any other error status does. So a new API call needs nothing extra to lead to "Anmeldung abgelaufen". Its caller still gets the rejection: catch it, and use `isLoginExpired(failure)` where a 401 must not end on a screen of its own, as `print()` does for "Drucken hat nicht geklappt".
- **"Anmeldung abgelaufen"** is not one of the screens of `Screen`. `App` has the signal `loginExpired`, and its `Match` is the first in the `Switch`, so it covers whatever screen shows and unmounts it (the status screen stops polling). It never goes away again: the only way on is the page load of "Neu anmelden".
- **Session check.** `App` calls `GET /api/session` every time it opens, beside whatever else the opening does. Only a 401 matters; any other failure is ignored.
- **"Neu anmelden"** loads `/login` (`shared/login.ts`). The service worker answers `/` from its cache, so the app's own address never reaches Cloudflare; `/login` always goes to the network. Cloudflare Access shows its login for it and sends the browser back to it afterwards, and the server answers it with a 303 to `/?logged-in=1` (`server/http/session.ts`). On the Household network there is no Cloudflare and no 401.
- **What survives the login.** The files are the phone's copy. The rest is `interruptedJob` in `ui/src/interrupted-job.ts`, one `localStorage` record (`print-buddy.interrupted-job`): the Print Options the person last tapped "Drucken" with, and on the status screen also the Print Job and when it was sent. `App` writes it when "Anmeldung abgelaufen" appears on the status screen, or while the phone holds the files of a job (`filesHeld`: from a share or "Datei auswählen" until `leaveJob()` or a Refusal). It takes it out on every open and uses it only when the address says `logged-in`, so it never outlives one page load.
- **Where the person lands after the login.**
  - The login ran out on the status screen: the status screen of the same Print Job. Nothing is uploaded. `StatusScreen` takes `since`, so "läuft seit" and the 60 s hint go on from when the job was sent.
  - It ran out anywhere else in a job (a share that just came in, an upload, "Drucken", "Nochmal drucken", "Erneut versuchen"): the phone's copy is uploaded into a new draft and the options screen opens. `OptionsScreen` takes `initial`, the Print Options to start with in place of the starred Preset.
  - No job was in progress (Start, "Bitte nochmal teilen", or the Refusal screen, where "Bericht kopieren" asks the server): Start.
  - The person closed the app on "Anmeldung abgelaufen" and opens it again: that is an open without a share, so the job is forgotten like any other.
- **Print Options are known to `App` while the options screen shows.** `OptionsScreen` owns them, reports every change with `onChange` (because the background upload can meet a 401 after the person changed something) and hands them over with `onPrint`. A 401 during the upload brings the person back to the options screen with what they had chosen.
- **"Bitte nochmal teilen"** is `ShareAgainScreen`, with "Datei auswählen". `openHeld()` and `uploadHeld()` go there whenever the phone holds no files: after the login, after a share and for "Nochmal drucken" and "Erneut versuchen".
- **A share that reached the server is lost,** because the server keeps no shared files. This happens when no service worker was running, with or without the Cloudflare login in between. The server sends the browser to `/?shared=lost`, and the app shows "Bitte nochmal teilen" and clears the phone's copy. The address has to say it: the phone may still hold the files of an earlier job, and they must not open in place of the lost share.
- **`leaveJob()`** also forgets the Print Options last sent. "Drucken hat nicht geklappt" now has "Schließen", which calls it.
- **No "Bericht kopieren" on "Anmeldung abgelaufen".** The spec lists the screens that have it, and this one is not among them. An expired login is no fault to report, and the report could not ask the server anything.
- **Tests.** `ui/src/testing/login.ts` has `loginExpired`, a route handler that answers as Cloudflare does (401, no JSON), and `logInAgain(user)`: it taps "Neu anmelden", checks that the app loaded an address the service worker lets through, unmounts the app and sets the address the server redirects to. Render `<App />` after it. Make the routes answer again before the call.
- **Not checked on a phone:** the whole round trip through the Cloudflare login, and whether the installed app is still there when the person comes back from the mail app with the PIN. Both are in the on-device checks.

### Notes from the options screen feedback (ticket 18)

- **Upload on pick, behind the options screen.** `openHeld()` in `App.tsx` starts the upload (`startUpload()` in `ui/src/upload.ts`: a new draft, one file per request in order) and at the same time reads the files' facts in the browser (`readFacts()` in `ui/src/file-facts.ts`). The options screen opens as soon as the facts are read, usually well before the upload is done. A file the browser can't read (not PDF, JPEG or PNG by its head, or a PDF pdf.js can't open) waits for the server as before; the server then refuses it or sends its facts.
- **Facts in the browser.** A PDF's page sizes come from pdf.js (`pageSizes()` in `ui/src/pdf-preview.ts`: the viewport at scale 1, without `/UserUnit`), which match `shownPart()` in `server/source-pdf.ts`; checked against intake for plain pages, `/Rotate` 90 and 270, CropBoxes partly outside the MediaBox and a 45° `/Rotate`. A photo's facts come from `photoFacts()` in `shared/file-header.ts`, the same function intake uses, with `exifr` in the browser too.
- **The server's facts count.** Once the upload is done, `OptionsScreen` gets the server's facts in place of the browser's. Drucken is unavailable until then and reads "Wird hochgeladen … n %" (the share of all files' bytes, at most 99 % until the server has answered for the last file), so the confirmation's sheet count and everything sent are laid out from the server's facts. Should the two disagree on the number of pages or photos, every one the server found is selected.
- **Endings of the upload.** A Refusal shows the Refusal screen whenever it arrives, on whatever screen. A 401 shows "Anmeldung abgelaufen" (the files stay on the phone; see the expired-login notes). Any other failure while the options screen shows leads to "Drucken hat nicht geklappt" with `printed: false`: "Erneut versuchen" then opens the options screen again with the same Print Options and a new upload, and prints nothing by itself. After Drucken, "Erneut versuchen" sends again as before.
- **"‹ Zurück"** on the options screen calls `leaveJob()`, which stops a running upload (the request is aborted; an answer that still comes changes nothing), clears the phone's copy and goes to Start.
- **PDFs start from "Dokument Farbe"**, the first built-in PDF Preset. A starred Preset on the phone still wins.
- **Layout.** Print size (`PrintSize`, with the compact `ChoiceGroup` and `Stepper`) and the smaller Position grid (32 px spots) sit side by side, each with a small caption. Controls on the screen are 40 px high. The Drucken bar is the last element of `<main>`, sticky at the bottom with a top border, so at the end of the page nothing lies under it. At 360 px the print size buttons leave about 20 px to the grid; a wider label there needs a new look at this row.
- **Preset row.** It scrolls sideways without a scrollbar. `PresetChips` fades the edge that has more chips beyond it (measured on scroll, on resize and when the chips change) and centres the marked chip when the screen opens.
- **Checked by hand in Chromium on localhost** (fake printer) at 412 × 915 and 360 × 800 with a five-page PDF and three PNG photos: nothing under the Drucken bar at the end of the page, Print size and Position side by side, the fades, the starred "Umschlag DL" scrolled into view. With the network throttled (1 MB/s up) and a 13 MB photo, the options screen showed after about 0.2 s and Drucken counted from 0 % to 98 % before it became available; "‹ Zurück" during that upload went to Start; a PDF with a photo showed the options screen, then "Bitte PDF und Fotos getrennt teilen" when the refusal arrived.

### Notes from a single page or photo and the swipe (ticket 19)

- **Nothing to choose, nothing shown.** With one page or one photo (`refs()` in `OptionsScreen` has one entry) the thumbnails, with "Alle" and "Keine", are left out. `SheetSteps` is left out whenever the layout has exactly one sheet: one page or photo, two pages on one sheet, or all but one left out. With nothing selected it still shows and says "Keine Seiten ausgewählt". So "Blatt in der Vorschau" is no sign that the screen is laid out: tests wait for the enabled "Drucken" and the status "Druckgröße in Prozent" instead.
- **Swipe.** `Preview` is the `region` named "Vorschau". It takes `index`, `count` and `onStep` beside the sheet, and steps on `pointerup` when the primary pointer moved at least 50 px sideways and more sideways than up or down; nothing at the first or last sheet, and nothing unless Ansicht is 100 %. At 100 % the panel has `touch-action: pan-y pinch-zoom`, so the page scrolls vertically over it and Chrome hands the sideways move to the app; when the browser takes a gesture over for scrolling it sends `pointercancel`, which drops the swipe. Zoomed in, `touch-action` is `auto` and a drag pans the panel as before. A swipe slides the new sheet in by 24 px over 150 ms with the Web Animations API (not with reduced motion); the sheet is drawn at once.
- **Why no CSS carousel.** Scroll snapping would need every sheet drawn side by side (pdf.js draws one at a time), and would fight with the sideways scrolling of a zoomed preview.
- **Tests.** `swipe(dx, dy)` in `ui/src/thumbnails.test.tsx` draws a touch pointer across the preview with `user.pointer`.
- **Checked by hand in Chromium on localhost** (fake printer, 412 × 915 with touch emulation, real touch input through the DevTools protocol): a one-page PDF and a single photo without thumbnails or arrows; a five-page PDF swiped to page 5 and back, with no step past either end; a vertical drag over the preview scrolled the page; at 200 % a sideways drag panned the preview and kept the sheet.
