# Print Buddy

A small web app for printing PDFs and photos from the family's Android phones on the household Printer. It runs as a Home Assistant add-on next to the CUPS add-on. The spec is in `.scratch/print-buddy/spec.md`; the vocabulary is in `GLOSSARY.md`.

This repository is also the Home Assistant add-on repository: `repository.yaml` at the root, the add-on in `print-buddy/`. Home Assistant pulls a ready-made image for the Raspberry Pi 4 (aarch64) and builds nothing.

## Install in Home Assistant

1. The CUPS add-on must be running, with a queue that prints a test page.
2. Settings > Apps > Install app > ⋮ > Repositories: add `https://github.com/Kuirak/print-buddy`. Always enter it exactly like this. Home Assistant derives the add-on's internal hostname from the text of this URL.
3. Install **Print Buddy** from the store. Check the two options (`printer_uri`, `upload_limit_mb`), turn on **Watchdog** and **Start on boot**, then start it. The Documentation tab (`print-buddy/DOCS.md`) explains the options, the optional LAN port and where the job files are.

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

### 4. Bypass fallback

Only if step 3 fails, that is Chrome offers no "Installieren" or Print Buddy is missing from the share sheet:

1. Add a second Access application for `print.example.org` with a Bypass policy for everyone, for exactly these paths: `/manifest.webmanifest`, `/sw.js` and the icon files the manifest names.
2. Add a tunnel route for the same paths to the same service, with "Protect with Access" off, and move it above the main route. Without it cloudflared still drops these requests.
3. Remove Print Buddy from the phone and repeat step 3.

Nothing else may be bypassed. These files contain no personal data.

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
2. Pick a one-page PDF and tap "Drucken".
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
| `pnpm build` | Builds the UI into `dist/ui`. |
| `pnpm start` | Starts the server the way the add-on does (`node server/main.ts`). |

The server reads these environment variables, for tests and local runs only:

| Variable | Default | Meaning |
|---|---|---|
| `PRINT_BUDDY_OPTIONS_FILE` | `/data/options.json` | The add-on options file (`printer_uri`, `upload_limit_mb`). A missing file or key gives the spec's default. |
| `PRINT_BUDDY_JOBS_DIR` | `/share/print-buddy/jobs` | Where Print Job folders live. Drafts are in `drafts/` below it. |
| `PRINT_BUDDY_PORT` | `9217` | Port to listen on. `0` picks a free one. |

### Layout

One package, no workspaces. Imports between folders are relative and end in `.ts` or `.tsx`.

```
shared/            Pure TypeScript for both sides. No DOM, no node: imports.
  print-options.ts   The Print Options type. The only definition.
  api.ts             JSON shapes of the HTTP API.
server/            Runs as `node server/main.ts`, straight from the sources.
  main.ts            Entry point: reads the config, starts the server.
  config.ts          Add-on options file and environment.
  server.ts          startServer(): listens, returns the URL and close().
  app.ts             Wires the modules together and mounts the routes.
  clock.ts           The injectable clock type.
  intake.ts          Upload intake (drafts).
  job-store.ts       Job store.
  printer/           Printer client: client.ts and the IPP codec.
  http/              One file per API resource: drafts, session, health, ui (static files).
  testing/           Seam 1 helpers: harness, fake IPP printer, fixtures.
  *.test.ts          Seam 1 tests, next to the sources.
ui/                Vite root.
  src/App.tsx        App shell: which screen shows.
  src/api.ts         One function per API operation. The only place that calls fetch.
  src/screens/       One screen per file.
  src/testing/       Seam 3 helpers.
  src/*.test.tsx     Seam 3 tests.
scripts/dev.ts     What `pnpm dev` runs.
print-buddy/       The Home Assistant add-on folder: config.yaml, DOCS.md, CHANGELOG.md, translations.
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

- `startTestServer(opts)` in `server/testing/harness.ts` starts the real server on a free port. It writes an options file that points `printer_uri` at the fake printer, and uses a temporary directory in place of `/share` and `/data`. `close()` stops everything and deletes the directory.
  - `opts.options`: extra keys for the options file, for example `{ upload_limit_mb: 1 }`.
  - `opts.now`: start time of the fake clock. `opts.ui`: files of a stand-in UI build.
  - `opts.beforeStart(printer)`: runs before the server starts, to script what the fake printer answers to the startup read of the margins.
  - It returns `request(path, init)`, `post(path, json?)`, `submit(draftId, overrides?)`, `upload(draftId, bytes, name, type)`, `url`, `jobsDir`, `clock`, `printer` and `startupRequests`.
  - `submit` posts `samplePrintOptions` from `server/testing/fixtures.ts` (one copy, black and white, A4, page 1), changed by `overrides`. A submit without valid Print Options is a 400.
  - `startupRequests` holds the IPP requests the server made while starting. They are taken out of `printer.requests`, so that list starts empty and holds only what the test caused.
- `server.clock` is the server's only source of time: `clock.now()` and `clock.advance(ms)`. Server code takes `now` from its dependencies and never calls `Date.now()` itself. For anything that runs on a schedule, expose a function the test can call after `clock.advance(…)`, instead of faking timers.
- `server.printer` is the fake IPP printer from `server/testing/fake-ipp.ts`. It answers like cupsd 2.4.10.
  - `printer.requests`: every IPP request received, decoded. Read attributes with `values(request, Tag.operation, "requesting-user-name")` or `findAttr(…)` from `server/printer/ipp-codec.ts`. `request.data` holds the document bytes.
  - `printer.jobs`: the jobs by CUPS job number. `printer.setJob(id, JobState.processing, ["job-printing"], "message")` scripts a state change.
  - `printer.printer`: the printer's `state`, `reasons` and `message`. `media` lists the entries of `media-col-database` (size and margins in 1/100 mm); `mediaColDatabase = false` leaves the margins out. `failNext = 503` makes the next request fail at HTTP level.
  - Cancel-Job from a user who doesn't own the job gets HTTP 401, as with real CUPS.
- `server/testing/fixtures.ts` holds small test files. Add new ones there, built in code and without dates or random ids.

**Seam 2: the layout module** (`shared/*.test.ts`, `node --test`)

Pure functions, so there is no helper: import the function and loop over a table of cases with literal expected numbers.

**Seam 3: UI components with the API mocked at `fetch`** (`ui/src/**/*.test.tsx`, vitest with happy-dom)

```tsx
import { render, screen } from "@solidjs/testing-library"
import { userEvent } from "@testing-library/user-event"
import { expect, test } from "vitest"
import { App } from "./App.tsx"
import { json, mockApi } from "./testing/mock-api.ts"

test("…", async () => {
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
  })
  const user = userEvent.setup()
  render(() => <App />)

  await user.click(screen.getByRole("button", { name: "Drucken" }))

  expect(await screen.findByText("…")).toBeInTheDocument()
  expect(api.calls[0]!.headers.get("X-Requested-With")).toBe("XMLHttpRequest")
})
```

- `mockApi(routes)` in `ui/src/testing/mock-api.ts` replaces `fetch` with a table keyed `"METHOD /path"`. A handler returns a `Response` (use `json(body, status)`), or a plain value that is sent as JSON with status 200. It may return a promise, to hold an answer back.
- `api.calls` lists every call with `method`, `path`, `headers` and `body`. `api.on(route, handler)` changes a route while the test runs.
- A call to a route that isn't in the table rejects, so a forgotten route fails the test.
- `ui/src/testing/setup.ts` unmounts the rendered app and removes the `fetch` stub after each test.
- Solid 2 applies signal writes in a microtask. `await user.click(…)` is enough to see the result; after `fireEvent` add `await Promise.resolve()`.
- With fake timers use `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })` and `await vi.advanceTimersByTimeAsync(ms)`.
- Never import `pdfjs-dist` in a component. Wrap it in one module of ours and mock that module with `vi.mock`.

### Notes from the first build

- **IPP library check (spec, "first build must confirm").** `@sealsystems/ipp` 2.11.0 can't send the PPD keywords. A Print-Job serialized with `copies`, `ColorMode`, `Quality`, `MediaType` and `PageSize` contains `copies` and none of the other four: the library drops attribute names it doesn't know, without an error. So the spec's fallback applies. The Printer client (`server/printer/`) is a small hand-written IPP client, and `@sealsystems/ipp` is not a dependency. Its codec was checked against a real cupsd 2.4.10. PPD keywords go out as `nameWithoutLanguage` values (`v.name(…)`), the way `lp -o` sends them.
- **Solid Testing Library and Solid 2.** `@solidjs/testing-library` supports Solid 2 only from its `next` tag. Version `1.0.0-rc.2` is pinned and works, so Seam 3 uses it and not Solid's own render utilities. The `latest` tag (0.8.x) is for Solid 1.
- **Solid 2 packages.** The DOM runtime is `@solidjs/web` and the Vite plugin is `@solidjs/vite-plugin`. `vite-plugin-solid` and `solid-js/web` are for Solid 1. Read `node_modules/solid-js/CHEATSHEET.md` before writing a component.
- **Dependencies.** The whole library list of the spec is installed already, including the ones no code uses yet (`@cantoo/pdf-lib`, `exifr`, `pdfjs-dist`), so that tickets built in parallel don't each change the lockfile.
- **Health path.** The health endpoint is `/health`, outside `/api`, for the HA watchdog. It never contacts CUPS.
- **Version.** `import { version } from "./version.ts"` in the server gives the Print Buddy version. It is read from `print-buddy/config.yaml`, the one source. `/health` answers `{ ok: true, version }`. Don't add a version to `package.json`.
- **Packaging.** The image holds `server/`, `shared/`, `dist/`, the production `node_modules` and `print-buddy/config.yaml`. A new top-level folder the server needs at run time must be added to the `Dockerfile`. Home Assistant treats every file named `config.yaml`, `config.yml` or `config.json` in a non-hidden folder as an add-on, so never add another file with one of these names. Try the image with `docker build --platform linux/arm64 -t print-buddy:dev .` and `docker run --rm -p 9217:9217 -v "$PWD/data:/data" print-buddy:dev`, with an `options.json` in `data/`.
- **Shutdown.** `server/main.ts` closes the server on SIGTERM and SIGINT, because node is PID 1 in the add-on (`init: false`). Anything that must finish before the process ends belongs in the server's `close()`.
- **What the skeleton leaves open.** Submit sends the upload as it is (renderer). The job store is in memory and drafts are never deleted (job folders and cleanup). A failed submit shows nothing in the app (failures). The status screen shows only that CUPS accepted the job.

### Print Options and printer info

- **Submit.** The body of `POST /api/drafts/:draftId/submit` is the Print Options object itself (`SubmitRequest` in `shared/api.ts`). `parsePrintOptions` in `shared/print-options.ts` checks all of it; anything invalid is a 400 `{ error: "invalid-options" }` and nothing is sent to CUPS. It doesn't check `selection` against the draft's files: that is for the renderer.
- **What CUPS gets.** `printer.printJob(pdf, options)` sends only `copies`, collated copies, `ColorMode`, `PageSize`, `Quality` and `MediaType`. Our paper names are the PPD's `PageSize` names. Everything else in the Print Options has to be drawn into the PDF.
- **Printable margins.** `GET /api/printer` answers `PrinterInfo`: `margins` per paper plus the printer's `state`, `reasons` and `message`. Margins are in points, for the sheet in portrait, as `{ top, right, bottom, left }`. On the server the same values come from `printer.margins()`. They are read once, while the server starts; a paper CUPS doesn't report gets 9 pt left and right, 12 pt top and bottom, with one warning in the log. When CUPS doesn't answer the state read, `state` is `unknown` and the margins are still there.
- **Options screen.** `OptionsScreen` owns the Print Options in a store and hands them to `onPrint`. A new file starts with one copy, black and white, A4, Normal, and an empty `selection`, because the app doesn't know the page count yet. The four rows (Kopien, Farbe, Papier, Qualität) are the rows of the prototype's options drawer, shown on the screen itself until the summary line with "Ändern" exists. `ui/src/controls/` has `Stepper` and `ChoiceGroup` (a `radiogroup` of buttons); tests find them by role and German name.

### Notes from upload intake (ticket 03)

- **File facts.** `FileFacts` in `shared/api.ts` is what the layout module and the renderer start from. For a PDF: `pageCount` and `pages[]`, each the size a reader shows (CropBox, with `/Rotate` applied), in points. For a photo: `format`, the stored pixel `width` and `height`, and the EXIF `orientation` (1 to 8, 1 when there is none). The pixel size is not turned: for orientations 5 to 8 the upright photo is `height` × `width`.
- **Refusals.** A refused upload answers `{ refusal }` (type `Refusal`) with status 413 (`too-large`, which also carries `limitMb`), 415 (`unsupported-type`) or 409 (the other three). The draft stays as it was. In the app, `addFile()` resolves with the facts or the Refusal and throws only for other failures. The German texts are in `ui/src/screens/RefusalScreen.tsx`.
- **Upload limit.** `hono/body-limit` counts the bytes as they arrive and answers 413 at `upload_limit_mb` plus 64 kB of multipart overhead, so an oversized file is never held. A file within the limit is read into memory once (at most `upload_limit_mb`), as the stack exploration recommended; there is no streaming to disk and no `busboy`.
- **Drafts on disk.** A draft's files are `drafts/<draft-id>/<n>.pdf|jpg|png`, numbered in upload order. `intake.files(draftId)` gives the path and the facts of each.
- **Photos can't print yet.** Submit still sends the draft's first file as it is, so Drucken on a photo draft sends a JPEG or PNG labelled as PDF. The renderer (ticket 07) ends that.
- **In the app.** The options screen state holds `files` (the phone's copies, in picked order) and `facts` (same order). `ui/src/controls/FilePicker.tsx` is the one "Datei auswählen"; the start and Refusal screens share it.
- **Fixtures.** `server/testing/fixtures.ts` has `pdfWithPages()` (sizes, `/Rotate`, CropBox), `sampleJpeg()` (40×30), `withExifOrientation()`, `samplePng(w, h)` and `encryptedPdf()`. Make test files different in size, so a test can tell them apart in a rendered PDF.
