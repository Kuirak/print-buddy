# How Print Buddy works

This file is ordered by area. `development.md` says where the files are and how to test. `adr/` says why some things are as they are.

This is the way of a Print Job. The phone picks or shares files. The app keeps them as the phone's copy and uploads them into a draft on the server. The options screen lays out the sheets with the layout module from the files' facts. On submit, the renderer builds one PDF with the same layout and the server sends it to CUPS. The job store keeps the job folder. The status screen asks the server, which asks CUPS, until the job has ended.

## Server

### Upload intake and drafts

- **File facts.** `FileFacts` in `shared/api.ts` is what the layout module and the renderer start from.
  - For a PDF, the facts are `pageCount` and `pages[]`. Each page has the size a reader shows, in points. That size is the part of the CropBox that lies on the page, with `/Rotate` applied. `shownPart()` in `server/source-pdf.ts` decides that part and the turn by the rules of pdf.js, for intake and for the renderer.
  - For a photo, the facts are `format`, the stored pixel `width` and `height`, and the EXIF `orientation`. The orientation is 1 to 8, and 1 when the photo has none. The pixel size is not turned, so for orientations 5 to 8 the upright photo is `height` × `width`.
- **Refusals.** A refused upload answers `{ refusal }` of type `Refusal`. The status is 413 for `too-large`, which also carries `limitMb`, 415 for `unsupported-type`, or 409 for the other three. The draft stays as it was. In the app, `addFile()` resolves with the facts or the Refusal and throws only for other failures. It takes a signal that stops it and an `onProgress` callback. The German texts are in `ui/src/screens/RefusalScreen.tsx`.
- **Upload limit.** `hono/body-limit` counts the bytes as they arrive. It answers 413 at `upload_limit_mb` plus 64 kB of multipart overhead, so the server never holds an oversized file. The server reads a file within the limit into memory once, at most `upload_limit_mb`. There is no streaming to disk and no `busboy`.
- **Drafts on disk.** A draft's files are `drafts/<draft-id>/<n>.pdf|jpg|png`, numbered in upload order. `intake.files(draftId)` gives the path and the facts of each. The list of drafts is in memory, and the server does not read it back after a restart.

### Print Options and the Printer

- **Submit.** The body of `POST /api/drafts/:draftId/submit` is the Print Options object itself, `SubmitRequest` in `shared/api.ts`. `parsePrintOptions` in `shared/print-options.ts` checks all of it. Anything invalid gets a 400 `{ error: "invalid-options" }`, and nothing goes to CUPS. `parsePrintOptions` doesn't check `selection` against the draft's files. The renderer does, with the same answer.
- **What CUPS gets.** `printer.printJob(pdf, options)` sends only `copies`, collated copies, `ColorMode`, `PageSize`, `Quality` and `MediaType`. It sends them as PPD keywords in `nameWithoutLanguage` values, `v.name(…)`, the way `lp -o` sends them. Our paper names are the PPD's `PageSize` names. Everything else in the Print Options has to be drawn into the PDF. The client in `server/printer/` is hand-written. See [ADR 0001](adr/0001-hand-written-ipp-client.md). Its codec was checked against a real cupsd 2.4.10.
- **Printable margins.** `GET /api/printer` answers `PrinterInfo`, which has `margins` per paper plus the Printer's `state`, `reasons` and `message`. Margins are in points, for the sheet in portrait, as `{ top, right, bottom, left }`. On the server the same values come from `printer.margins()`. The server reads them once, while it starts. A paper CUPS doesn't report gets 9 pt left and right and 12 pt top and bottom, with one warning in the log. When CUPS doesn't answer the state read, `state` is `unknown` and the margins are still there.

### The layout module

`layout()` in `shared/layout.ts` decides where every page or photo sits. The renderer and the preview both call it and add no geometry of their own. See [ADR 0002](adr/0002-one-layout-for-preview-and-print.md).

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
- `source` takes the intake's facts. Pass `PdfFacts` as it is, or `{ kind: "photos", photos }` with the `PhotoFacts` of the draft in order. `margins` is `PrinterInfo.margins[options.paper]`, or `printer.margins()[options.paper]` on the server.
- The result has one entry per sheet, so its length is the sheet count for one copy. `sheetCount(sheets, copies)` is the number of sheets of paper the whole Print Job takes. The confirmation and the server both count with it. Each sheet has `placements`, `cutOff`, `emptySpace` and `sideways`.
- `cutOff` means content lies outside the printable area, so it is true at Füllen whenever the Printer has margins. `emptySpace` means part of the printable area stays empty. A job is cut off when any sheet is.
- A placement's `left`, `top`, `width` and `height` are its box on the sheet, measured from the sheet's top-left corner. `rotation` is the clockwise turn of the upright content. `scale` × 100 is the effective percentage.
- **Renderer.** Write `matrix` as the `cm` operator and draw the page or photo. The matrix maps the content at its natural size, as stored, onto the sheet in PDF coordinates. EXIF orientation and every turn are already in it.
  - An image XObject is a unit square, so scale it by `photoNaturalSize(pixels)` first.
  - A PDF page's own `/Rotate` and CropBox are not in the matrix. `layout()` gets the displayed page size, and the renderer adds the step from the embedded page to the displayed page.
  - Clip each placement to its `clip` box. With two pages per sheet that box is the half, and Füllen would otherwise run into the other half.
- **Preview.** Draw the upright picture into the box, turned by `rotation` and clipped to `clip`. An `<img>` already shows a photo upright, and pdf.js applies `/Rotate`.
- **Two pages per sheet** is laid out the way CUPS lays out `number-up=2`. The sheet is read in landscape and split into a left and a right half. On a portrait sheet, which all four papers are, the pages therefore lie turned 90° clockwise with page 1 in the top half, and the sheet says `sideways: true`. The preview shows such a sheet turned 90° counter-clockwise. Photos always get one sheet each.

### Renderer

- **What CUPS receives.** Submit calls `render(files, options, margins)` in `server/renderer.ts` and sends its PDF, never an uploaded file. The result also has `sheets`, the number of sheets of paper the job takes, copies included. All photos of a draft go into one PDF and one Print Job.
- **Form fields and annotations.** pdf-lib embeds only a page's content. So `drawAnnotations()` in `server/source-pdf.ts` first draws the annotations into the page. It draws each one's normal appearance, fitted to its rectangle, if the annotation is flagged for printing and not hidden. The preview asks pdf.js for the same set.
- **Print Options that don't fit the draft** get a 400 `{ error: "invalid-options" }`, the same answer as malformed ones. These are:
  - an empty `selection`
  - a page number outside 1 to the page count
  - a photo index outside 0 to the photo count minus 1
  - `pagesPerSheet: 2` for photos

  The app never submits an empty selection, because Drucken is unavailable then.
- **PNG memory.** The renderer embeds photos one after the other, and each selected photo once. pdf-lib unpacks a PNG to raw pixels, about 360 MB for 4000×3000 on a Mac. So a large PNG batch is slow on the Pi. This was not measured there.

### Submit and the job folder

- **Job folder.** `<jobs dir>/<date>_<job-id>/` holds `upload-1.pdf`, `print.pdf` and `job.json`. In place of `upload-1.pdf` it can hold `upload-1.jpg`, `upload-2.png`, … in upload order. The date is the UTC day the job was sent. No file carries the name it had on the phone.
- **`print.pdf` is what CUPS got.** Submit in `server/http/drafts.ts` holds the rendered bytes in one variable, `pdf`. It passes that variable to both `printer.printJob(pdf, options)` and `jobs.add({ …, pdf })`. Keep it that way, so the folder can't hold anything other than what was printed.
- **Submit uses up the draft.** After CUPS has accepted the job, `jobs.add` moves the uploads into the job folder and `intake.discard(draftId)` forgets the draft. A second submit of that draft gets a 404. To print again, upload into a new draft, as "Nochmal drucken" does.
- **A submit that can't be sent** answers `SubmitFailure` from `shared/api.ts`. The status is 502 for `cups-unreachable` or `cups-rejected`, and 500 for `render-failed`. No Print Job is created and the draft stays, so the same submit can be repeated. The cause goes to the server log.
- **After CUPS has accepted the job, submit answers with the Print Job whatever else fails.** See [ADR 0004](adr/0004-accepted-job-is-always-answered.md). A job folder that can't be filled, a `job.json` that can't be written and a draft that can't be deleted are logged and not thrown. The job's status stays readable from memory until the server restarts.
- **`job.json`** is the `PrintJob` record of `server/job-store.ts`. Its fields are:
  - `id`, `cupsJobId`, `sentAt`, `endedAt` and `sheets`
  - `file`, with the type, size and page or photo count of what was uploaded
  - `options`, the Print Options
  - `details`, what CUPS last said
  - `cancelled`

  The two times are ISO 8601 text in the file and millisecond numbers in the record. A new field of `PrintJob` lands in the file by itself. It must never be a name of a person, an email or a file name. See [ADR 0005](adr/0005-nothing-personal-is-kept.md).
- **Job store.** `await jobs.update(job, changes)` gives the changed record. The store never changes a record in place. It applies the changes to the record as the store holds it now, so an older copy in the caller's hand can't bring old values back. `details`, `endedAt` and `cancelled` are the fields that change after `add`. The store writes the file at submit and whenever `jobs.update` changes something. A status read that learns nothing new writes nothing.
- **After a restart.** `openJobStore` reads every `job.json` back, so `GET /api/jobs/:jobId` works as before and goes on asking CUPS. It skips a folder whose `job.json` can't be read, with a warning.
- **Cleanup.** `startServer` runs it once before it listens and then every hour. `RunningServer.cleanup()` is the same function. It has two parts, each in the module that owns the folders:
  - `jobs.cleanup()` deletes job folders more than 7 days after `sentAt`. A folder without a readable `job.json` counts from the end of the day in its name.
  - `intake.cleanup()` deletes drafts more than 1 hour after they were created, and every draft folder that has no draft. That covers what an earlier run of the server left behind, since nobody can submit those any more.
  - Both look only at entries named like their own folders. Those are `<date>_<uuid>` in the jobs directory and `<uuid>` in `drafts/`. Anything else a person puts there stays.

### Job status

- **Reading a Print Job.** `GET /api/jobs/:jobId` answers `JobStatus` from `shared/api.ts`. It has `state`, `reason`, `details`, `cupsJobId`, `sentAt`, `endedAt` and `sheets`, and for the report `file` and `options`.
  - `state` is a `ScreenState` key, one of `waiting`, `printing`, `done`, `cancelled` and `error`. The German words are in `ui/src/state-words.ts`.
  - `reason` is a German sentence, or null when there is nothing to explain.
  - `details` is what CUPS said. It has `jobState` as the IPP keyword, `jobStateReasons`, `printerStateReasons` from `job-printer-state-reasons`, and `printerMessage` from `job-printer-state-message`.
- **Each read asks CUPS** with Get-Job-Attributes, until the job has ended. The first read that sees the end sets `endedAt` from the server's clock, so it can be up to one poll late. After that the server answers the stored state and doesn't ask CUPS again. When CUPS can't answer, or no longer knows the job, the read answers the last state seen, with a warning in the log. A read looks at the record again once CUPS has answered. If a cancel or another read saw the job end in the meantime, that result stands and the read drops the late answer.
- **Status mapper.** `mapStatus(details, cancelledByPrintBuddy)` in `server/status-mapper.ts` is the one place that decides state and reason. A `processing` job is Wartet when its printer message says the Printer isn't connected yet, per `notConnectedMessages`. `processing-stopped` is Wartet too.
- **Reasons.** `reasonTexts` maps reason keywords to German sentences. The mapper looks through the job's reasons, then the Printer's. It takes the first keyword it knows, with a trailing `-report`, `-warning` or `-error` removed. After that it checks the backend message against `messageTexts`.
- **Which states have a reason.** Fehler always has one. It is the known reason, or "Beim Drucken ist ein Fehler aufgetreten.", or the sentence for a job somebody else cancelled. Wartet and Wird gedruckt have one only when CUPS names a known reason. Fertig and Abgebrochen have none.
- **Cancel.** `POST /api/jobs/:jobId/cancel` answers the new `JobStatus`, or 409 `{ error: "not-cancellable" }`. A cancel is allowed exactly while the job reads as Wartet. CUPS marks every cancelled job the same way, so the job store's `cancelled` flag records Print Buddy's own cancel. The server sets the flag before it asks CUPS and takes it back when CUPS refuses. So a status read that overlaps the cancel never takes it for somebody else's. `printer.cancelJob()` resolves false when CUPS refuses with `IppRefusal`, which is a bare HTTP status or an IPP error status. It throws only when CUPS can't be reached.
- **Sheet count.** Submit sets `sheets` to `sheetCount()` of the layout module. That is the number of sheets in the rendered PDF times `copies`, so it follows `selection` and `pagesPerSheet`.

## App

### Screens and the phone's copy

- **The phone's copy.** `phoneFiles` in `ui/src/phone-files.ts` is the one place that keeps the files of the job in progress. Its functions are `keep(files)`, `held()` and `clear()`. It is one record in IndexedDB, in database `print-buddy` and store `phone-files`. So it survives a full page load, and it works over plain HTTP too. The service worker puts a share there, and `pick()` puts picked files there. `beginUpload()` in `App.tsx` starts every upload. A share, "Datei auswählen", "Nochmal drucken" and "Erneut versuchen" all upload what the store holds. No screen state carries files from screen to screen, except the options screen, which shows them. See [ADR 0003](adr/0003-files-stay-on-the-phone.md).
- **When the copy goes.** `leaveJob()` in `App.tsx` clears the phone's copy. It does so on "Schließen", on "‹ Zurück", and when an upload finds the store empty. A Refusal clears it, because nothing prints. Opening the app without a share clears it, because no job is in progress then. "Drucken hat nicht geklappt" keeps it until "Schließen".
- **New ways in and out.** Every new way out of a job has to call `leaveJob()`. Every new way in has to go through `phoneFiles.keep()` and `openHeld()`.
- **"Datei auswählen"** is `ui/src/controls/FilePicker.tsx`, the one file picker. The Start, Refusal and "Bitte nochmal teilen" screens share it.

### Start screen

- `canReceiveShares` is true where the browser has a service worker. Over plain HTTP it is false and the share hint is not shown.
- The logo, the name and "PDFs und Fotos vom Handy drucken" sit in the middle. "Datei auswählen" is the last element, at the bottom within reach of the thumb with the phone in one hand. It is not sticky. When the screen is too short, for example with a large font, the page scrolls, and nothing lies over "Bericht kopieren". On screens up to 640 px tall the logo is 80 px instead of 112.
- **Last job.** `lastJob` in `ui/src/last-job.ts` keeps `{ jobId, cupsJobId }` of the last submit in `localStorage` under `print-buddy.last-job`. `print()` in `App.tsx` writes it. `LastJobLine` reads the job once when Start shows, as "Letzter Druck: {Zustand}" with the report button. A 404 forgets the job, because the job folder is gone after 7 days. Any other failure shows "Letzter Druck: unbekannt" and still offers the report.

### Share-to-print

- **The way of a share.** The manifest, `ui/public/manifest.webmanifest`, tells Android to POST to `/share-target`. The service worker answers that POST itself with `receiveShare()` in `ui/src/share-target.ts`. It puts the files into the store, then answers with a 303 to `/?shared=1`. `App` sees `shared` in its address, shows `OpeningScreen`, removes the parameter and calls `openHeld()`. The path, the form field and the parameter are constants in `shared/share-target.ts`, and a test keeps the manifest equal to them.
- **Until the options screen opens with a share,** `OpeningScreen` shows the app's name and "Wird geladen …". It shows them while the browser reads the files. For a file the browser can't read, it shows them until the server has the file.
- **A share without files** ends on "Bitte nochmal teilen". This happens with a known Chrome bug, or with a body Chrome can't read.
- **`/share-target` on the server** answers every method with a 303 to `/?shared=lost` and keeps nothing. A request reaches it when no service worker took the share, and when the browser comes back to that address from the Cloudflare login. The app then shows "Bitte nochmal teilen" and clears the phone's copy. The address has to say so, because the phone may still hold the files of an earlier job, and they must not open in place of the lost share.

### Service worker and updates

- **Service worker.** The `serviceWorker()` plugin in `vite.config.ts` builds `ui/src/sw.ts`. It runs a second build, after the app, into one self-contained `/sw.js`. The plugin fills in `__APP_SHELL__` with the list of files the app build wrote and a hash over their contents. Those files are the page and everything under `/assets`. `handledBy(request)` decides who answers: `share`, `shell` or `network`. `shell` answers from the cache `print-buddy-shell-<hash>`. Only `/` and `/assets/*` ever come from the cache. API calls, `/login`, `/sw.js`, the manifest and the icons always go to the server. A file that is loaded later, such as the pdf.js worker, is in the shell as long as Vite emits it under `/assets`.
- **Updates.** The browser installs a changed `/sw.js` in the background, and the new worker waits. `startAppUpdate()` in `ui/src/app-update.ts` tells it to take over only while no job is in progress. It does so when the app opens on Start, when the new version finishes installing while Start shows, and from `leaveJob()`. `App` reports the job with `update.setJobInProgress()`. The worker takes over only if this window is the only one open. Otherwise it waits until all are closed. After the take-over the page reloads once, unless a job has begun in the meantime.
- **Files pdf.js fetches.** `scripts/pdfjs-assets.ts` copies `wasm`, `standard_fonts`, `cmaps` and `iccs` from `node_modules/pdfjs-dist` into `ui/public/pdfjs`. They are 4 MB and not in git. Vite takes them into `dist/ui/pdfjs`. pdf.js fetches one from `/pdfjs/…` only when a PDF needs it, for example for a scanned page in JBIG2 or JPEG 2000, or for a font that isn't embedded. These files are not in the app shell and always come from the server. `pnpm build`, `pnpm dev` and `pnpm dev:ui` run the script first. A bare `vite build` leaves the files out. The Dockerfile runs `pnpm run build`.
- **Icons.** `ui/public/icon.svg` and `icon-maskable.svg` are the sources. `ui/src/controls/Logo.tsx` draws the same printer on the Start screen, inline so that it shows from the cache too. `print-buddy/logo.svg` puts it beside the name for the Home Assistant app page. Change all four together. Make the PNGs with `rsvg-convert -w 512 -h 512 icon.svg -o icon-512.png`, and with 192 for the small one. In `print-buddy/`, make `icon.png` at 128 from `ui/public/icon.svg` and `logo.png` at 500 × 200 from `logo.svg`. Home Assistant shows the icon in the app store and the logo on the app page. Never rename the manifest, `/sw.js` or an icon. See [ADR 0006](adr/0006-fixed-addresses-for-the-installed-app.md).

### Upload behind the options screen

- **Upload on pick.** `openHeld()` in `App.tsx` starts the upload with `startUpload()` in `ui/src/upload.ts`, which makes a new draft and sends one file per request in order. At the same time it reads the files' facts in the browser with `readFacts()` in `ui/src/file-facts.ts`. The options screen opens as soon as the facts are read, usually well before the upload is done. Some files the browser can't read. Those are files that aren't PDF, JPEG or PNG by their head, and PDFs pdf.js can't open. Such a file waits for the server, which then refuses it or sends its facts.
- **Facts in the browser.** A PDF's page sizes come from pdf.js through `pageSizes()` in `ui/src/pdf-preview.ts`. It takes the viewport at scale 1, without `/UserUnit`. These sizes match `shownPart()` in `server/source-pdf.ts`. They were checked against intake for plain pages, `/Rotate` 90 and 270, CropBoxes partly outside the MediaBox and a 45° `/Rotate`. A photo's facts come from `photoFacts()` in `shared/file-header.ts`, the same function intake uses, with `exifr` in the browser too.
- **The server's facts count.** Once the upload is done, `OptionsScreen` gets the server's facts in place of the browser's. Drucken is unavailable until then and reads "Wird hochgeladen … n %". The percentage is the share of all files' bytes, at most 99 % until the server has answered for the last file. So the confirmation's sheet count and everything sent are laid out from the server's facts. If the two disagree on the number of pages or photos, every one the server found is selected.
- **The options screen state** in `App.tsx` holds `files`, `facts` and the running `upload`. `files` is the phone's copy, in shared or picked order. `facts` is in the same order and holds the browser's facts until the server's arrive.
- **Endings of the upload.** A Refusal shows the Refusal screen whenever it arrives, on whatever screen. A 401 shows "Anmeldung abgelaufen", and the files stay on the phone. Any other failure while the options screen shows leads to "Drucken hat nicht geklappt" with `printed: false`. "Erneut versuchen" then opens the options screen again with the same Print Options and a new upload, and prints nothing by itself. After Drucken, "Erneut versuchen" sends again.
- **"‹ Zurück"** on the options screen calls `leaveJob()`. It aborts a running upload request, and an answer that still comes changes nothing. Then it clears the phone's copy and goes to Start.

### Options screen

- **Top to bottom**, the screen has these parts:
  - "‹ Zurück" with the file name
  - Preset chips
  - preview
  - Print size beside the Position grid
  - thumbnails
  - summary line with "Ändern"
  - Drucken
- **State.** `OptionsScreen` owns the Print Options in a store. It reports every change with `onChange` and hands the Print Options to `onPrint`. A new file starts from the default Preset of its file type with everything selected. `selection` is every page of the PDF or every photo, from the `facts` prop. After a login, `initial` replaces the Preset, as "Expired login" below describes. `Stepper` and `ChoiceGroup` are in `ui/src/controls/`. `ChoiceGroup` is a `radiogroup` of buttons whose values are strings or numbers. Tests find both by role and German name.
- **One layout for the whole screen.** `OptionsScreen` reads the margins with `readPrinter()`, and reads them again every 2 s for as long as that read fails. It calls `layout()` in one memo, `sheets`. The preview, the percentage in the Print size row, the cut-off warning, the stepper and the confirmation all read that memo. None of them computes a size or a place. Until the margins are there, nothing is laid out. The paper is empty, Drehen and Drucken are off and the − / + buttons are left out.
- **Layout of the screen.** Print size and the smaller Position grid sit side by side, each with a small caption. Print size is `PrintSize`, with the compact `ChoiceGroup` and `Stepper`. The Position grid has 32 px spots. Controls on the screen are 40 px high. The Drucken bar is the last element of `<main>`, sticky at the bottom with a top border, so at the end of the page nothing lies under it. At 360 px the print size buttons leave about 20 px to the grid. A wider label there needs a new look at this row.
- **Print size row.** − and + move in steps of 5 from the percentage shown and switch to a percentage. The range is 10 to 400 %, taken from the prototype. `100 %` is marked only at exactly 100.

#### Preview

- **The preview** is `ui/src/controls/Preview.tsx`, the `region` named "Vorschau". It gets one `Sheet` of the layout module, the paper size and the margins. It only turns points into percent of the sheet. For each placement it draws the `clip` box, in it the placement's box, and in that the upright picture turned by `rotation`. It draws every placement of the sheet, so two pages per sheet show as the layout module puts them. A `sideways` sheet is shown turned 90° counter-clockwise, edge and all.
- **Which sheet.** `shown()` in `OptionsScreen` is the sheet the person stepped to. Drehen turns the whole PDF, or the photo of the first placement of the shown sheet through `photoRotations`.
- **The pictures.** `ui/src/controls/PdfPage.tsx` draws one PDF page through `openPdf(bytes)` and `renderPage(pageNumber, longSide)` of `ui/src/pdf-preview.ts`. The preview uses it with `fit="fill"` and a label. The thumbnails use it with `fit="contain"` at 176 px. pdf.js draws with `intent: "print"`, so a form field or an annotation shows exactly when the server's renderer draws it too. For photos, the preview and the thumbnails show the phone's copy from the `files` prop through object URLs. The screen revokes the URLs when it goes. An `<img>` applies the EXIF orientation itself.
- **Black and white, paper, edge.** Black and white is a CSS `grayscale` filter on the picture. The sheet has the paper's aspect ratio and always fills the same panel, so A4 and A5 look alike except for the wider edge. The unprintable edge is a dashed frame at the margins with a pale veil outside it. The warning is about content under the veil or beyond the paper.
- **Ansicht**, `ViewZoom`, is 100, 150, 200 or 300 %, on the screen only. The panel then scrolls in both directions. A PDF page is drawn again with more pixels, with a long side of 1500 px × zoom and at most 3000.
- **Swipe.** `Preview` takes `index`, `count` and `onStep` beside the sheet. It steps on `pointerup` when the primary pointer moved at least 50 px sideways, and more sideways than up or down. It does nothing at the first or last sheet, and nothing unless Ansicht is 100 %.
  - At 100 % the panel has `touch-action: pan-y pinch-zoom`. So the page scrolls vertically over it and Chrome hands the sideways move to the app. When the browser takes a gesture over for scrolling, it sends `pointercancel`, which drops the swipe.
  - Zoomed in, `touch-action` is `auto` and a drag pans the panel.
  - A swipe slides the new sheet in by 24 px over 150 ms with the Web Animations API, except with reduced motion. The sheet is drawn at once.
- **Why no CSS carousel.** Scroll snapping would need every sheet drawn side by side, but pdf.js draws one at a time. It would also fight with the sideways scrolling of a zoomed preview.

#### Selection, thumbnails and stepping

- **Selection.** `OptionsScreen` starts with every page or photo selected. `toggle(ref)` is the one place that changes a single entry. `selection` is always in the file's order, so a page brought back goes to its place, never to the end. Nothing reorders photos.
- **Thumbnails** in `ui/src/controls/Thumbnails.tsx` are the `group` named "Seiten" or "Fotos". Each is a button named "Seite 2" or "Foto 2" with `aria-pressed`, and its picture is decoration. "Alle" and "Keine" sit below. A thumbnail shows the page or photo upright as it is in the file, in grey when black and white is chosen. It doesn't follow rotation, Print size or paper. The screen draws all thumbnails of a PDF when it opens, one request per page, not only the visible ones.
- **Stepping.** `SheetSteps` shows "‹ Seite 3 · 2/4 ›". That is the page on the sheet, then which sheet of how many, for one copy. The second number is the sheet count of the selection. With two pages per sheet it reads "Seiten 3 und 4 · 2/2", and for photos "Foto 2/3". It is the `status` named "Blatt in der Vorschau", and the buttons are "Vorheriges Blatt" and "Nächstes Blatt". The screen keeps the step past the end and clamps it when read, in `current()`. So leaving out the last page shows the sheet before it. Bringing a page back shows its sheet. "Alle" and "Keine" go to the first.
- **Nothing to choose, nothing shown.** With one page or one photo, the thumbnails and "Alle" and "Keine" are left out. `refs()` in `OptionsScreen` then has one entry. `SheetSteps` is left out whenever the layout has exactly one sheet. That happens with one page or photo, with two pages on one sheet, or with all but one left out. With nothing selected it still shows.
- **Nothing selected.** The status reads "Keine Seiten ausgewählt" or "Keine Fotos ausgewählt". The Drucken button is disabled and reads "Keine Seiten gewählt" or "Keine Fotos gewählt".
- **Seiten pro Blatt** is a row with `1` and `2`, for PDFs only.

#### Details, summary and confirmation

- **Detailed controls.** `OptionsDrawer` is a sheet at the bottom edge, the dialog named "Einstellungen". It holds Kopien, Farbe, Papier, Qualität, Seiten pro Blatt for PDFs only, the Preset actions and "Fertig". "Ändern" and the last Preset chip open it. Every change applies at once and the preview behind follows. There is nothing to undo. A new option that is not on the spec's list for the screen goes in here as one more row.
- **Summary line.** `SummaryLine` is the `status` named "Gewählte Einstellungen", for example `2× · S/W · A4 · Normal · Einpassen (97 %) · Mitte · 2 Seiten pro Blatt · Seiten 1, 3-5`. Photos have no pages per sheet. The last part says which pages or photos print, for example "alle 6 Seiten", "Seiten 1-3, 5", "2 von 3 Fotos" or "keine Seiten".
- **Confirmation.** Drucken on the screen only opens `Confirmation`, the dialog named "Jetzt drucken?". Its own Drucken calls `onPrint`. "Abbrechen" closes it and leaves the Print Options untouched. It stays open while the job is sent, and `print()` in `App.tsx` ignores a second tap.
  - The first line is `4 Seiten (1, 3-5; 2 pro Blatt) × 2 Kopien = 4 Blätter` or `2 Fotos × 3 Kopien = 6 Blätter`. The page ranges show only when pages are left out.
  - The second line is `Schwarz-Weiß · A4 · Füllen (104 %)`, with ` · Toner sparen` when chosen.
  - Then comes `⚠ Teile des Inhalts werden abgeschnitten.` when any sheet is cut off.
- **Nothing is computed there.** The sheet count is `sheetCount()` of the layout module over the screen's one `sheets` memo and the copies. The percentage is the one the Print size row shows, and the warning is the same flag. The server's `sheets` is the same function over the same layout, so the two can't differ. Drucken on the screen is unavailable until the margins have arrived, so the confirmation always has its numbers.
- **No "Drucken (n Kopien)"** on the button, which the prototype had. The copies are in the summary line right above it and in the confirmation.
- **Words.** `ui/src/job-text.ts` has the names of papers, qualities and Positions, `ranges()` for "1-3, 5", `counted()` for "1 Seite" and "3 Seiten", and `printSizeText()`. The drawer, the Position grid, the summary line and the confirmation all take them from there.
- **Dialogs.** `Dialog` in `ui/src/controls/` is the dimmed backdrop with a panel, in the middle or at the bottom edge. A tap beside the panel and Escape close it, and it takes the focus when it opens. Whoever opens a dialog makes the screen behind it `inert`. `OptionsScreen` keeps which dialog is open in `over` and sets `inert` on its `<main>`.

#### Presets

- **Where.** `ui/src/presets.ts` has the built-in Presets, the `PresetValues` type and `createPresets(kind)`, which reads and writes browser storage. `PresetValues` holds the seven fields a Preset stores. `PresetChips` and `PresetActions` under `ui/src/controls/` are the two parts on the screen. Both take the Print Options and call `onPick`, and `OptionsScreen` applies the Preset to its store.
- **A new field in the Print Options.** If a Preset should store it, add it to `PresetValues`, to `sameValues` and to `save` in `presets.ts`, and to the built-ins. Presets already store and compare Print size, Position and pages per sheet, so their controls only have to write the Print Options store. `rotation`, `selection` and `photoRotations` belong to the file, and a Preset never touches them.
- **File type.** `OptionsScreen` takes `kind: FileKind`, which is `"pdf" | "photo"` in `shared/api.ts`. `fileKind(facts)` in `presets.ts` is the one place that decides it. It takes the `kind` the server found for the first file of the Print Job, because a draft never mixes the two. `App` calls it. The kind picks the chips, the default Preset and which star is set. `OptionsScreen` reads it once, so a new file gets a new `OptionsScreen`.
- **Starting options.** A new file starts from the starred Preset of its type plus `rotation: 0` and every page or photo selected. Nothing from a Print Job is written to storage, so the next file can't inherit it.
- **Chips per type.** PDFs get Dokument Farbe, Dokument s/w and Umschlag DL. Dokument Farbe is the built-in default and comes first. Photos get Foto and Foto s/w Toner sparen. An own Preset belongs to the file type it was saved for.
- **Which chip is marked.** The marked chip is the Preset whose seven fields all equal the Print Options. If several are equal, it is the one tapped or saved last, else the first in chip order. If none is equal, the last chip reads "✎ Eigene". Otherwise it reads "Eigene …". Tapping that chip opens the detailed controls, where the Preset actions are too.
- **Preset row.** It scrolls sideways without a scrollbar. `PresetChips` fades the edge that has more chips beyond it, measured on scroll, on resize and when the chips change. It centres the marked chip when the screen opens.
- **Storage.** Presets live in one `localStorage` key, `print-buddy.presets`, as `{ own: Preset[], defaults: { pdf?: id, photo?: id } }`. Entries that don't pass `parsePrintOptions` are dropped on load. A starred id that no longer exists falls back to the built-in default.

### Status screen and failures

- **Status screen.** It assumes Wartet until the first answer. It polls with a timeout chain, 2 s after each answer, and stops once `endedAt` is set. The running timer counts from `since`, the time the job was sent by the phone's clock. "gedauert" is `endedAt - sentAt` from the server. The 60 s hint shows while the state is Wartet and the timer is at 60 s or more. Every ended state offers "Schließen" and "Nochmal drucken". The screen shows `reason` in every state that has one. Fehler adds "Details" with `ui/src/controls/Collapsible.tsx`. That is a button with `aria-expanded`, and the content is in the page only while open.
- **Nochmal drucken.** The status screen state in `App.tsx` keeps `options`. `print(options)` without a draft id uploads the phone's copy into a new draft and submits it with the same Print Options, without going back to the options screen.
- **"Drucken hat nicht geklappt".** Anything that throws inside `print()` in `App.tsx` leads to `SendFailedScreen`. That covers upload and submit, an error status and no network. Its screen state keeps `options`. "Erneut versuchen" calls `print(options)` without a draft id, so the phone's copy is uploaded into a new draft, as with "Nochmal drucken". "Schließen" calls `leaveJob()`. Some screens must come before it for one kind of failure, such as the expired login. Such a screen has to catch that failure first.

### Expired login

- **Where a 401 is noticed.** `call()` and `upload()` in `ui/src/api.ts` notice it for every API call, whoever makes it. They tell the listener `App` set with `onLoginExpired()` and then fail as any other error status does. So a new API call needs nothing extra to lead to "Anmeldung abgelaufen". Its caller still gets the rejection and has to catch it. Use `isLoginExpired(failure)` where a 401 must not end on a screen of its own, as `print()` does for "Drucken hat nicht geklappt".
- **"Anmeldung abgelaufen"** is not one of the screens of `Screen`. `App` has the signal `loginExpired`, and its `Match` is the first in the `Switch`. So it covers whatever screen shows and unmounts it, and the status screen stops polling. It never goes away again. The only way on is the page load of "Neu anmelden".
- **Session check.** `App` calls `GET /api/session` every time it opens, beside whatever else the opening does. Only a 401 matters, and `App` ignores any other failure.
- **"Neu anmelden"** loads `/login`, from `shared/login.ts`. The service worker answers `/` from its cache, so the app's own address never reaches Cloudflare. `/login` always goes to the network. Cloudflare Access shows its login for it and sends the browser back to it afterwards. The server answers it with a 303 to `/?logged-in=1`, in `server/http/session.ts`. On the Household network there is no Cloudflare and no 401.
- **What survives the login.** The files are the phone's copy. The rest is `interruptedJob` in `ui/src/interrupted-job.ts`, one `localStorage` record under `print-buddy.interrupted-job`. It holds the Print Options the person last tapped "Drucken" with. On the status screen it also holds the Print Job and when it was sent.
  - `App` writes it when "Anmeldung abgelaufen" appears on the status screen, or while the phone holds the files of a job. That state is `filesHeld`, from a share or "Datei auswählen" until `leaveJob()` or a Refusal.
  - `App` takes it out on every open and uses it only when the address says `logged-in`, so it never outlives one page load.
  - `leaveJob()` also forgets the Print Options last sent.
- **Print Options are known to `App` while the options screen shows**, through `onChange`, because the background upload can meet a 401 after the person changed something. A 401 during the upload brings the person back to the options screen with what they had chosen.
- **Where the person lands after the login.**
  - If the login ran out on the status screen, the person lands on the status screen of the same Print Job. Nothing is uploaded. `StatusScreen` takes `since`, so "läuft seit" and the 60 s hint go on from when the job was sent.
  - If it ran out anywhere else in a job, the phone's copy is uploaded into a new draft. The options screen opens with `initial`, the Print Options to start with in place of the starred Preset. This covers a share that just came in, an upload, "Drucken", "Nochmal drucken" and "Erneut versuchen".
  - If no job was in progress, the person lands on Start. This covers Start, "Bitte nochmal teilen", and the Refusal screen, where "Bericht kopieren" asks the server.
  - If the person closed the app on "Anmeldung abgelaufen" and opens it again, that is an open without a share. So the job is forgotten like any other.
- **"Bitte nochmal teilen"** is `ShareAgainScreen`, with "Datei auswählen". `openHeld()` and `uploadHeld()` go there whenever the phone holds no files. That happens after the login, after a share, and for "Nochmal drucken" and "Erneut versuchen".
- **No "Bericht kopieren" on "Anmeldung abgelaufen".** The spec lists the screens that have it, and this one is not among them. An expired login is no fault to report, and the report could not ask the server anything.

### Report

- **Report builder.** It is `ui/src/report.ts`. `buildReport(input)` is a pure function that makes the text. `copyReport(subject)` reads what it needs and writes the clipboard. A `ReportSubject` is either `{ job }`, the two numbers from submit, or `{ happened, files, options? }` for a report without a Print Job. `happened` is one German sentence. `files` is a function, called when the report is made.
- **Where the facts come from.** For a Print Job, the report reads everything from the server when the button is tapped.
  - `GET /api/jobs/:jobId` asks CUPS, so the state is live.
  - `GET /api/report` answers `ReportFacts`, the Print Buddy version and the Printer's state now.

  For this, `JobStatus` carries `file` and `options`. `file` has `kind`, `bytes` and `count`, the pages of the PDF or the photos in the job. Submit stores both in `job.json`. A server that doesn't answer doesn't stop the report. The report then says "unbekannt (Server nicht erreichbar)".
- **No file name.** Of the phone's files the builder reads only `type` and `size`. A new line in the report must not come from a `File`'s name, from file contents or from an error message the browser made up. See [ADR 0005](adr/0005-nothing-personal-is-kept.md). The report writes the Print Options with their keys as they are in `shared/print-options.ts`, so a new option shows up by itself.
- **The button.** It is `<ReportButton subject={…} />` in `ui/src/controls/`. It says "Kopiert", or "Kopieren hat nicht geklappt" when the browser refuses the clipboard, in an element with role `status`. A new screen where something can go wrong adds this one line with a `{ happened, files }` subject.
- **Send failures.** The `send-failed` screen state keeps what `print()` caught as `error`. `sendFailure(error)` in `report.ts` turns it into the sentence. The Refusal screen state keeps the refused `file`, because the phone's copy is cleared on a Refusal.
