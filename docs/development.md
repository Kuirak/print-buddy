# Development

Needs Node 26, pnpm 12, and MuPDF's `mutool` on the `PATH` (`brew install mupdf`), which the tests of Dell jobs and the ink of uploaded PDFs run. Run `pnpm install` once. How the parts work is in `architecture.md`; decisions that are hard to reverse are in `adr/`; the vocabulary is in `GLOSSARY.md`.

## Commands

| Command | What it does |
|---|---|
| `pnpm test` | All tests: server and shared code under `node --test`, then the UI under vitest. |
| `pnpm typecheck` | Type checks everything with `tsc --noEmit`, which never emits anything. |
| `pnpm dev` | Starts the app with hot reload on http://localhost:5173, or the address Vite prints when that port is taken, against a fake printer, with a temporary jobs directory. Nothing reaches a real printer. Vite serves the page and keeps the state of the screen when a source file changes; the server of the fake printer answers `/api` on port 9217, or on `PRINT_BUDDY_PORT` (`0` picks a free one, which the proxy follows). There is no service worker in this mode. Each Print Job is Wartet for 5 s, so that "Abbrechen" can be tried, then Wird gedruckt for 5 s, then Fertig. |
| `pnpm test:server`, `pnpm test:ui` | One half of `pnpm test`. A single file: `node --test server/print.test.ts`, `pnpm vitest run src/App.test.tsx`. |
| `pnpm dev:built` | The same fake printer, but the page is the built app from `dist/ui` on http://localhost:9217, with its service worker, as the add-on serves it. Use it to try the install, a share and the update notes. It builds first and does not reload by itself. |
| `pnpm build` | Copies the files pdf.js fetches while drawing into `ui/public/pdfjs`, builds the UI into `dist/ui`, and after it the service worker `dist/ui/sw.js`. |
| `pnpm start` | Starts the server the way the add-on does, with `node server/main.ts`. |

The server reads these environment variables, for tests and local runs only:

| Variable | Default | Meaning |
|---|---|---|
| `PRINT_BUDDY_OPTIONS_FILE` | `/data/options.json` | The add-on options file, with the keys `printer_name` and `upload_limit_mb`. A missing key gives the spec's default. A missing `printer_name` stops the start. |
| `PRINT_BUDDY_CUPS` | `172.30.32.1:631` | Host and port of CUPS. The queue address is `ipp://<this>/printers/<printer_name>`. |
| `PRINT_BUDDY_JOBS_DIR` | `/share/print-buddy/jobs` | Where Print Job folders live. Drafts are in `drafts/` below it. |
| `PRINT_BUDDY_PORT` | `9217` | Port to listen on. `0` picks a free one. |

## Layout

One package, no workspaces. Imports between folders are relative and end in `.ts` or `.tsx`.

```
shared/            Pure TypeScript for both sides. No DOM, no node: imports.
  print-options.ts   The Print Options type, with the layout and one item per page or photo. The only definition.
  layout.ts          The layout module: the Cells or slots of a layout, where content sits in them, or why the Print Options can't print, and how many sheets a Print Job takes.
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
  renderer.ts        Renderer: builds the PDF or HBPL that goes to CUPS.
  dell-engine.ts     Dell's engine from the share folder: its file format, and the toner codes of a row of pixels.
  pdf-raster.ts      A page of a PDF as rows of pixels at 600 dpi, rendered by MuPDF's mutool, for Dell's engine.
  pdf-content.ts     Where each page of an uploaded PDF has ink, from a 72 dpi rendering by mutool, for the cut-off warning.
  status-mapper.ts   Status mapper: CUPS job facts to a screen state and a German reason.
  printer/           Printer client: client.ts, the IPP codec, and hbpl.ts, which runs foo2hbpl2 on the raster of a Dell job.
  http/              One file per API resource: drafts, jobs, printer, report, session (with /login), health, share-target, ui (static files).
  testing/           Seam 1 helpers: harness (with an optional Dell engine, and foo2hbpl2 replaced by a pass-through or a test's own stand-in), fake IPP printer, fixtures, and rendered-pdf.ts, which reads a printed PDF back.
  *.test.ts          Seam 1 tests, next to the sources.
ui/                Vite root.
  index.html         The page.
  public/            Served as they are: manifest.webmanifest and the icons. `pdfjs/` is copied in by the build and not in git.
  src/main.tsx       Entry point: mounts App. app.css beside it has the Tailwind setup, the two button classes and the chip classes.
  src/App.tsx        App shell: which screen shows.
  src/api.ts         One function per API operation. The only place that talks to the server: fetch, and XMLHttpRequest for uploads.
  src/upload.ts      The upload of the phone's copy into a draft, with its progress; it runs behind the options screen.
  src/file-facts.ts  The facts of the phone's copy, read in the browser so the options screen needn't wait for the upload.
  src/presets.ts     The Presets: the built-in ones, and the own ones and starred defaults in browser storage.
  src/print-options-editor.ts  The Print Options editor: every edit of the Print Options on the options screen, and what follows from them. No Solid.
  src/phone-files.ts The phone's copy of the files of the job in progress.
  src/interrupted-job.ts  What else of a job survives the page load of the login.
  src/share-target.ts  Which requests the service worker answers itself, and what it does with a share.
  src/app-update.ts  When a new version of the installed app may take over, and when the person is told about it.
  src/report.ts      The report builder: the plain text behind "Bericht kopieren".
  src/last-job.ts    The last Print Job from this phone, for the line on Start.
  src/job-text.ts    The German words for the Print Options, as the confirmation and "Nochmal drucken?" say them.
  src/state-words.ts The German words for the five states of a Print Job.
  src/pdf-preview.ts The only module that imports pdfjs-dist: opens a PDF, reads its page sizes and draws a page onto a canvas.
  src/sw.ts          The service worker. Built into /sw.js; its logic is in share-target.ts and app-update.ts.
  src/screens/       One screen per file.
  src/controls/      One hand-built control per file: stepper, Position grid, preset chips, layout strip, preview, the bar under it and so on.
  src/testing/       Seam 3 helpers, and setup.ts, which vitest runs before every test file.
  src/*.test.tsx     Seam 3 tests, all in this one folder. Tests of pure modules, such as the editor, sit beside them as *.test.ts.
scripts/dev.ts     What `pnpm dev` runs.
scripts/pdfjs-assets.ts  Runs before every build: copies pdf.js's decoders, fonts and character maps into ui/public/pdfjs.
scripts/dell-engine.ts  Measures Dell's macOS driver into the file of Dell's engine. Runs on a Mac with the driver.
vite.config.ts     The UI build, the second build for the service worker, and the vitest settings.
print-buddy/       The Home Assistant add-on folder: config.yaml, README.md (the intro in the store), DOCS.md, CHANGELOG.md, translations.
repository.yaml    Makes the repository an add-on repository.
Dockerfile         The add-on image. Built by .github/workflows/release.yaml, never by Home Assistant.
docs/              This file, architecture.md, and the decisions in adr/.
```

## Rules

- One server module per entry in the spec's Modules list. New ones get their own file, for example the renderer, the status mapper, the report builder and the layout module in `shared/`. `app.ts` only constructs and mounts them.
- One API resource per file under `server/http/`, mounted with one line in `app.ts`, above the two catch-all lines.
- One screen per file under `ui/src/screens/`. Put each hand-built control in its own file under `ui/src/controls/`, for example the stepper, the Position grid and the preset chips.
- `shared/` imports nothing outside `shared/`. `server/` and `ui/` never import each other.
- The server runs through Node's type stripping. So use no `enum` and no constructor parameter properties, use `import type` for types, and write real file extensions in imports. `pnpm typecheck` rejects all of these.
- `dependencies` holds only what the server imports at run time. Everything the UI uses is a `devDependency`, because Vite bundles it.
- All visible text is German. The wording comes from the spec and the options-screen prototype.
- Nothing personal is stored or logged. See [ADR 0005](adr/0005-nothing-personal-is-kept.md).

## The server process and the image

- **Version.** `import { version } from "./version.ts"` in the server gives the Print Buddy version. It is read from `print-buddy/config.yaml`, the one source. `/health` answers `{ ok: true, version }`. Don't add a version to `package.json`.
- **Health path.** The health endpoint is `/health`, outside `/api`, for the Home Assistant watchdog. It never contacts CUPS.
- **Packaging.** The image holds `server/`, `shared/`, `dist/`, the production `node_modules` and `print-buddy/config.yaml`, foo2hbpl2 with its source under `/usr/local/share/foo2hbpl2/source`, built from a pinned foo2zjs commit, and Alpine's `mupdf-tools`. A new top-level folder the server needs at run time must be added to the `Dockerfile`. Home Assistant treats every file named `config.yaml`, `config.yml` or `config.json` in a non-hidden folder as an add-on, so never add another file with one of these names. Try the image with `docker build --platform linux/arm64 -t print-buddy:dev .` and `docker run --rm -p 9217:9217 -v "$PWD/data:/data" print-buddy:dev`, with an `options.json` in `data/`.
- **Shutdown.** `server/main.ts` closes the server on SIGTERM and SIGINT, because node is PID 1 in the add-on, which sets `init: false`. Anything that must finish before the process ends belongs in the server's `close()`.

## The real Printer

- **Against your own CUPS.** `pnpm dev` always uses the fake printer. To print for real, run `pnpm build` once. Then run `pnpm start` with `PRINT_BUDDY_OPTIONS_FILE` naming a file `{ "printer_name": "<queue>" }`, `PRINT_BUDDY_JOBS_DIR` set to a temporary folder, and `PRINT_BUDDY_CUPS=<host>:631`. CUPS has to accept jobs from the LAN. When it can't be reached, the log warns at start that the margins are unknown.
- **Dell's engine.** Colour Print Jobs print through it when `/share/print-buddy/dell-engine.json` is there. See [ADR 0007](adr/0007-colour-print-jobs-print-through-dells-engine.md). The file is Dell's data: never commit it.
  1. On a Mac, install Dell's C1765nfw driver and add the printer, so that a CUPS queue uses Dell's PPD.
  2. Run `node scripts/dell-engine.ts dell-engine.json`. It prints nothing. It needs `git` and `cc` the first time, to build `hbpldecode` from foo2zjs into the temp folder.
  3. Copy `dell-engine.json` into the add-on's share folder as `print-buddy/dell-engine.json` and restart the add-on. Its log says "Colour Print Jobs print through Dell's engine".

  Run it again after an update of Dell's driver. To print through the engine from a local `pnpm start`, set `PRINT_BUDDY_DELL_ENGINE` to the file, and put a foo2hbpl2 on the `PATH`: in a foo2zjs checkout, `cc -O2 -w -o foo2hbpl2 foo2hbpl2.c jbig.c jbig_ar.c`. Colour PDFs need `mutool` as well.

## Solid 2

- **Packages.** The DOM runtime is `@solidjs/web` and the Vite plugin is `@solidjs/vite-plugin`. `vite-plugin-solid` and `solid-js/web` are for Solid 1. Read `node_modules/solid-js/CHEATSHEET.md` before writing a component.
- **Testing Library.** `@solidjs/testing-library` supports Solid 2 only from its `next` tag. Version `1.0.0-rc.2` is pinned and works, so Seam 3 uses it and not Solid's own render utilities. The `latest` tag, 0.8.x, is for Solid 1.

## Tests: the three seams

Tests go through one of three seams, or loop over tables of cases against a pure module of the app (see Seam 3). Seam tests assert on what a user or CUPS would see. They use random ports and temporary directories.

### Seam 1: the HTTP API against a fake IPP printer

`server/*.test.ts`, `node --test`.

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
  - `opts.options` holds extra keys for the options file, for example `{ upload_limit_mb: 1 }`.
  - `opts.now` is the start time of the fake clock. `opts.ui` holds the files of a stand-in UI build.
  - `opts.beforeStart(printer)` runs before the server starts. Use it to script what the fake printer answers to the startup read of the margins.
  - It returns `request(path, init)`, `post(path, json?)`, `submit(draftId, overrides?)`, `upload(draftId, bytes, name, type)`, `print(overrides?, files?)`, `cleanup()`, `restart()`, `url`, `jobsDir`, `clock`, `printer` and `startupRequests`.
  - `submit` posts `samplePrintOptions` from `server/testing/fixtures.ts`, changed by `overrides`. `samplePrintOptions` is one copy, black and white, A4, Normal, one item printed once: what a new one-page PDF starts with. A submit without valid Print Options is a 400. For a draft of more pages or photos pass one item each, for example `{ items: items(1, 1, 1) }` with `items(...counts)` from the fixtures.
  - `print` sends a whole Print Job. It creates a new draft, uploads each file and submits, then returns `{ jobId, cupsJobId }`. Without `files` it sends `samplePdf()`.
  - `startupRequests` holds the IPP requests the server made while starting. They are taken out of `printer.requests`, so that list starts empty and holds only what the test caused.
  - `cleanup()` does what the server does when it starts and every hour. It deletes old job folders and drafts. Call it after `clock.advance(…)`.
  - `restart()` stops the server and starts it again on the same directories, printer and clock, as a restart of the add-on does. `url` changes with it, so read `server.url` after the restart and don't keep a copy.
- `server.clock` is the server's only source of time. It has `clock.now()` and `clock.advance(ms)`. Server code takes `now` from its dependencies and never calls `Date.now()` itself. For anything that runs on a schedule, expose a function the test can call after `clock.advance(…)`, instead of faking timers.
- `server.printer` is the fake IPP printer from `server/testing/fake-ipp.ts`. It answers like cupsd 2.4.10.
  - `printer.requests` holds every IPP request received, decoded. Read attributes with `values(request, Tag.operation, "requesting-user-name")` or `findAttr(…)` from `server/printer/ipp-codec.ts`. `request.data` holds the document bytes.
  - `printer.jobs` holds the jobs by CUPS job number. `printer.setJob(id, JobState.processing, ["job-printing"], "message", ["media-empty-warning"])` scripts a state change. The last argument is `job-printer-state-reasons`.
  - `printer.printer` holds the printer's `state`, `reasons` and `message`. `media` lists the entries of `media-col-database`, with size and margins in 1/100 mm. `mediaColDatabase = false` leaves the margins out. `failNext = 503` makes the next request fail at HTTP level. `unreachable = true` drops every connection, like a CUPS that is down. `acceptingJobs = false` makes it refuse Print-Job with an IPP error.
  - Cancel-Job from a user who doesn't own the job gets HTTP 401, as with real CUPS.
  - `printer.hold(Op.getJobAttributes)` keeps back the answer to the next request with that operation, for tests where two requests overlap. `arrived` resolves when the request is there, and `release()` sends the answer, which says what was true when the request arrived.
  - The printer client rounds margins to 0.01 pt, which gives 9.01 and 11.99 pt for the fake printer. The renderer uses exactly those, and so does the preview through `GET /api/printer`.
- **Fixtures.** `server/testing/fixtures.ts` holds small test files. Add new ones there, built in code and without dates or random ids. Make test files different in size, so a test can tell them apart in a rendered PDF.
  - `pdfWithPages()` takes sizes, `/Rotate`, CropBox, form fields and annotations. Its pages have a content stream, because pdf-lib can't embed a page without one. `{ blank: true }` makes a page without `/Contents`; it prints as an empty sheet unless an annotation is drawn on it. `annotations` puts form fields and annotations on a page, each with its dictionary entries as text and its appearance. `pdfWithPages(pages, { needAppearances: true })` sets the form's `/NeedAppearances`.
  - The other fixtures are `sampleJpeg()`, which is 40×30, `withExifOrientation()`, `samplePng(w, h)`, `pngWithPixels(rows)`, `jpegWithPixels(rows)` and `encryptedPdf()`.
- **Reading the printed PDF.** `readRenderedPdf(request.data)` in `server/testing/rendered-pdf.ts` gives the sheets with their size and items. Each item has `kind`, `size`, `box`, `clip` and `corners`. `size` tells fixtures apart. It is the size of the embedded part of the page before `/Rotate`, or the photo's pixels. `box` and `clip` are on the sheet, measured from the top-left corner. `corners` show rotation and mirroring. A photo also has `filter` and `bytes`. A page with form fields or annotations drawn into it also has `annotations`. They hold the rectangle each one takes up on the source page and the content stream of its appearance. Numbers are rounded to 0.01 pt. `server/render.test.ts` sets the fake printer's margins to zero where that keeps the expected numbers simple.
  - `drawnObjects(bytes)` counts the stored pages and photos the sheets draw, so a test sees that a page printed eight times is stored once.
  - `strokedBoxes(bytes)` gives the rectangles stroked on each sheet with their line width and grey: the cut lines.
- **Dell jobs.** With `dellEngine` in the harness options, colour photo and PDF jobs go out as HBPL, and the fake printer receives the raster foo2hbpl2 would get: one byte per 600 dpi pixel, `RASTERS[paper]` per sheet. PDF jobs run the real mutool. `server/dell-print.test.ts` builds a small engine of its own, never Dell's data.
- **Status reasons.** To teach the status mapper a new reason, add a line to one of its two tables and a case to the table test in `server/status.test.ts`.
- **Who printed.** `server/report.test.ts` sends the Cloudflare Access headers with every request of a Print Job and checks that nothing of them reaches CUPS, the job folder, the answers or the log.

### Seam 2: the layout module

`shared/*.test.ts`, `node --test`. The tests cover pure functions, so there is no helper. Import the function and loop over a table of cases with literal expected numbers.

### Seam 3: UI components with the API mocked at `fetch` and `XMLHttpRequest`

`ui/src/*.test.tsx`, vitest with happy-dom.

The same folder holds the tests of pure modules of the app, as `ui/src/*.test.ts`, under the same vitest. They render nothing: like Seam 2, each loops over tables of cases against the module's interface. `print-options-editor.test.ts` has a table for every edit, the Pan rule, the Preset edit, the server's facts, the Photo format defaults and the derived values such as the percentage and the mixed sizes. A rule of the Print Options gets its case there. Seam 3 keeps one case per thing the person sees.

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

- `mockApi(routes)` in `ui/src/testing/mock-api.ts` replaces `fetch` and `XMLHttpRequest`, which the uploads use, with one table keyed `"METHOD /path"`. A handler returns a `Response`, built with `json(body, status)`, or a plain value that is sent as JSON with status 200. It may return a promise, to hold an answer back. A handler that throws is a call that got no answer.
- `api.calls` lists every call with `method`, `path`, `headers`, `body` and `signal`, which is aborted when the app stopped the call. `api.on(route, handler)` changes a route while the test runs.
- An upload reports its whole body as sent when its answer arrives. Take two photos of 600 and 400 bytes, made with `jpegFile(name, w, h, bytes)`, and hold back the second answer. Drucken then reads "Wird hochgeladen … 60 %".
- A call to a route that isn't in the table rejects, so a forgotten route fails the test. Two routes answer without being in the table, unless the table has its own handler for them. `GET /api/session`, which the app asks every time it opens, answers as for a valid login. `GET /api/printer` answers `printerInfo()` from `ui/src/testing/printer-info.ts`. So `api.calls[0]` of a rendered `<App />` is the session check. Find other calls by their path.
- Every options screen reads `GET /api/printer`, so `api.calls` holds that GET too. Filter the calls you assert on. Drucken is unavailable until `GET /api/printer` has answered.
- `ui/src/testing/setup.ts` unmounts the rendered app and removes the stubs after each test. It also gives every test an empty phone storage, an empty `localStorage`, a stand-in for pdf.js and addresses for photos that name their file. The points below describe these. A test "reopens the app" with `cleanup()` and a second render.
- Solid 2 applies signal writes in a microtask. `await user.click(…)` is enough to see the result; after `fireEvent` add `await Promise.resolve()`.
- With fake timers use `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })` and `await vi.advanceTimersByTimeAsync(ms)`.
- `ui/src/testing/options-screen.ts` has the taps nearly every test needs. `printAndConfirm(user)` taps Drucken, then Drucken in "Jetzt drucken?". `openDetails(user)` taps "Einstellungen" and `closeDetails(user)` taps "Fertig". `shownSettings(user)` opens the detailed controls, reads copies, colour, paper and quality, and closes them again. `confirmation()` finds the open dialog, `laidOut()` waits until Drucken can be tapped, and `items(...counts)` builds the `items` of Print Options. A test that expects a Print Job to be sent uses `printAndConfirm`, never a bare tap on Drucken.
- A test that goes on to the status screen needs a `GET /api/jobs/<id>` route. Without one the screen stays on Wartet, because a failed poll is tried again and never fails the test. `jobStatus(changes?)` in `ui/src/testing/job-status.ts` builds the answer: job `j1`, CUPS job 42, waiting since `sentAt`.
- **pdf.js is a stubbed boundary, like `fetch`.** happy-dom has no worker and no canvas that draws, so a test can't see what pdf.js puts on a canvas. Never import `pdfjs-dist` in a component. `ui/src/pdf-preview.ts` wraps it, and the setup file replaces that module for every test. The stand-in opens any bytes as a PDF. Its pages have the sizes of the `/MediaBox [0 0 w h]` entries in the bytes, or it has one A4 page when there are none. `pdfFile(name, pages)` in `ui/src/testing/files.ts` writes such bytes. For each page it is asked to draw, the stand-in gives an empty canvas that says what was asked. `data-pdf` holds the file's bytes as text, `data-page` the page, and the canvas's `width` the pixels asked for. Assert on these canvases where they sit on the screen. Assert on what was asked to be drawn and where it shows, never on how often `openPdf` or `renderPage` ran.
- **Files the browser reads.** The options screen opens from the facts the browser reads. "Upload behind the options screen" in `architecture.md` describes this. A file made with `pdfFile()` or `jpegFile()` opens the options screen before the upload is done. Any other test file opens it only when the server has answered, from the facts the test's route sends. For example, `new File(["\xff\xd8\xff"], …)` is not a JPEG head once encoded.
- A photo's picture has the address `blob:<file name>`, because the setup file replaces `URL.createObjectURL`, whose own addresses are random. `expect(picture).toHaveAttribute("src", "blob:Strand 1.jpg")` says which photo shows.
- Tests don't assert on styling, so grey, the paper's shape and the edge of the preview are not covered by them.

### Seam 3 by area

- **Layout ready.** "Blatt in der Vorschau" is left out when the layout has one sheet, so it is no sign that the screen is laid out. Wait with `laidOut()` for the enabled "Drucken" instead. For a PDF, the status "Druckgröße in Prozent" shows the percentage too; photos have no − and +. With nothing printed the button named "Drucken" doesn't exist. It reads "Keine Seiten gewählt" or "Keine Fotos gewählt".
- **Dialogs.** Testing Library still finds what is behind an open dialog, so a test must not tap it. Where a name is on both, such as Drucken or "Einstellungen", search inside the dialog with `within(confirmation())`. `sheetCount()` and the sheet limit of `layOut()` have their own cases in `shared/layout.test.ts`, and the confirmation's numbers theirs in `ui/src/print-options-editor.test.ts`. `ui/src/confirmation.test.tsx` covers the panel; its limit state is rendered with `Confirmation` alone, because the screen never opens it over the limit.
- **Presets.** In `ui/src/presets.test.tsx` the preset chips are the `radiogroup` named "Voreinstellung". Saving and deleting a Preset ask on the screen itself, with a name field and "Voreinstellung löschen?", not with `window.prompt` or `window.confirm`.
- **Wie oft and the preview.** `ui/src/thumbnails.test.tsx` covers the counts, "Alle gleich", the layout strip's grids and stepping; `ui/src/preview.test.tsx` the picking and the bar; `ui/src/formats.test.tsx` the Photo formats and Eigenes; `ui/src/chips.test.tsx` the chip controls. pdf.js draws the thumbnails too. A test tells the canvases apart by where they sit, inside a thumbnail's button or inside the preview. It also tells them apart by width. Thumbnails are 176 wide, the preview 1500 and more. `ui/src/testing/setup.ts` stands in for `IntersectionObserver` and reports every picture as in view at once, so the thumbnails of a long PDF draw. `swipe(dx, dy)` in `thumbnails.test.tsx` draws a touch pointer across the preview with `user.pointer`.
- **Shares and the service worker.** `share(files)` in `ui/src/testing/share.ts` sends the request the manifest declares through `receiveShare()` and follows the redirect; render `<App />` after it. `fakeServiceWorker()` in `ui/src/testing/fake-service-worker.ts` stands in for `navigator.serviceWorker`: `newVersionInstalled()`, `takeOver()`, and `messages` for what the app told the waiting version. Without it a test runs as over plain HTTP. `ui/src/testing/fake-indexeddb.ts` is the phone's storage; it keeps values as they are, so an uploaded file is the same object as the picked one. Assert on the phone's copy with `phoneFiles.held()`. Chromium rejects `formData()` on an empty multipart body, which happy-dom does not.
- **Report.** `ui/src/report.test.tsx`. `userEvent.setup()` puts a working clipboard on `navigator`, so a test reads the report with `navigator.clipboard.readText()`. A test that taps "Bericht kopieren" needs a `GET /api/report` route, or the report says the server was not reachable. A test that goes back to Start after a Print Job causes one more `GET /api/jobs/<id>`.
- **Expired login.** `ui/src/testing/login.ts` has `loginExpired` and `logInAgain(user)`. `loginExpired` is a route handler that answers as Cloudflare does, with a 401 and no JSON. `logInAgain(user)` taps "Neu anmelden" and checks that the app loaded an address the service worker lets through. It then unmounts the app and sets the address the server redirects to. Render `<App />` after it. Make the routes answer again before the call.
