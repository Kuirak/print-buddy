# Print Buddy

A small web app for printing PDFs and photos from the family's Android phones on the household Printer. It runs as a Home Assistant add-on next to the CUPS add-on. The spec is in `.scratch/print-buddy/spec.md`; the vocabulary is in `GLOSSARY.md`.

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
  layout.ts          The layout module: where content sits on a sheet.
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
  await server.post(`/api/drafts/${draftId}/submit`)

  assert.equal(server.printer.requests.length, 1)
})
```

- `startTestServer(opts)` in `server/testing/harness.ts` starts the real server on a free port. It writes an options file that points `printer_uri` at the fake printer, and uses a temporary directory in place of `/share` and `/data`. `close()` stops everything and deletes the directory.
  - `opts.options`: extra keys for the options file, for example `{ upload_limit_mb: 1 }`.
  - `opts.now`: start time of the fake clock. `opts.ui`: files of a stand-in UI build.
  - It returns `request(path, init)`, `post(path, json?)`, `upload(draftId, bytes, name, type)`, `url`, `jobsDir`, `clock` and `printer`.
- `server.clock` is the server's only source of time: `clock.now()` and `clock.advance(ms)`. Server code takes `now` from its dependencies and never calls `Date.now()` itself. For anything that runs on a schedule, expose a function the test can call after `clock.advance(…)`, instead of faking timers.
- `server.printer` is the fake IPP printer from `server/testing/fake-ipp.ts`. It answers like cupsd 2.4.10.
  - `printer.requests`: every IPP request received, decoded. Read attributes with `values(request, Tag.operation, "requesting-user-name")` or `findAttr(…)` from `server/printer/ipp-codec.ts`. `request.data` holds the document bytes.
  - `printer.jobs`: the jobs by CUPS job number. `printer.setJob(id, JobState.processing, ["job-printing"], "message")` scripts a state change.
  - `printer.printer`: the printer's `state`, `reasons` and `message`. `mediaColDatabase = false` leaves the margins out. `failNext = 503` makes the next request fail at HTTP level.
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

- Everything is in points. `selection` holds PDF page numbers counted from 1, or photo indexes counted from 0. `photoRotations` is keyed by photo index.
- The result has one entry per sheet, so its length is the sheet count for one copy. Each sheet has `placements`, `cutOff`, `emptySpace` and `sideways`.
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
- **Dependencies.** The whole library list of the spec is installed already, including the ones no code uses yet (`@cantoo/pdf-lib`, `exifr`, `pdfjs-dist`), so that tickets built in parallel don't each change the lockfile.
- **Health path.** The health endpoint is `/health`, outside `/api`, for the HA watchdog. It never contacts CUPS.
- **What the skeleton leaves open.** The API accepts any file as a PDF and has no size limit yet (upload intake). Submit takes no Print Options and sends the upload as it is (options, renderer). The job store is in memory and drafts are never deleted (job folders and cleanup). A failed upload or submit shows nothing in the app (refusals, failures). The status screen shows only that CUPS accepted the job.
