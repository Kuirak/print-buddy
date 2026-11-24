# Changelog

Newest first. Versions are `YYYY.MM.N`: year, month, and a counter that starts at 0 each month. Changes collect under "Unreleased" until the next release gives them a version.

## 2026.11.8

- "Fotos" beside Drucken adds more photos to a print, up to 20, from wherever the screen is scrolled. They come after the photos already there, which keep their counts, turns, sizes and the layout; only the new ones are uploaded.
- PDFs now start at Füllen in "Dokument Farbe" and "Dokument s/w": an A4 page prints at its own size instead of being shrunk to 97 %. "Teile des Inhalts werden abgeschnitten" only shows when there is something printed in the part that is cut off; blank paper at the edge no longer triggers it. Print Buddy looks at each page when the PDF is uploaded to find that out.
- Colour prints through Dell's engine no longer lose the far edges of the printable area: the Printer now gets only its printable area, as it does from the queue's driver, so a frame drawn at the edge of the page is printed whole.

## 2026.11.7

- A page or photo that reaches over the edge of the printable area can be moved: pick it in the preview and drag the four-arrow sign on it (or use the arrow keys) to choose which part is cut off. It shows the same part of itself wherever it appears, also in a turned slot of "Platz sparen". Switching Füllen/Einpassen, "Größe für alle" and Position put it back.
- "Datei auswählen" shows the loading screen at once and opens the picked files without waiting.
- The preview keeps one height, so switching between portrait and landscape sheets moves nothing below it. "Größe für alle" and Position sit right under the preview.
- "Drucken hat nicht geklappt" names the cause and offers "Einstellungen ändern"; Print Options the server refused get no retry.
- The status screen shows the Print Buddy, a line per state and what is printing. "Bericht kopieren" is a quiet link.

## 2026.11.6

- Several pages or photos fit on one sheet: pick Normal, 2×, 4×, 6× or 8× in the row under the preview. "Seiten pro Blatt" in the settings is gone.
- Photos can print at a fixed size: 10×15, 9×13, 13×18, Passbild, or an own size in mm. As many as fit go on a sheet, lying whichever way fits the most ("Platz sparen"), or all upright or all across. A small gap and thin cut lines help cutting them apart.
- "Wie oft" says for each page or photo how often it prints, from "aus" up to 50 times, and "Alle gleich" sets them all at once. Four photos twice each fill one sheet at 8×.
- Tap a page or photo in the preview to turn just that one, or to switch it between Füllen and Einpassen. The "Drehen" button is gone, and "Größe für alle" sets the size of all of them.
- "Jetzt drucken?" now starts with how many sheets of paper the job takes, with a small sketch of the layout, every page or photo with how often it prints, and every setting at a glance. The line of settings under the preview is gone: "Einstellungen" beside "Ansicht" opens copies, colour, paper and quality.
- One print takes at most 100 sheets, copies included.
- Own presets saved with an earlier version are removed, because they stored the old "Seiten pro Blatt". The built-in ones stay; save your own again.
- On a tablet the options screen is wider, and on a laptop the preview stands beside the controls.

## 2026.11.5

- Colour PDFs now print like Dell's own driver too, when Dell's engine is in `/share/print-buddy/`: smooth colour, without a grid of dots, with deep black. Print Buddy prepares every page itself first, so "Wird vorbereitet" takes longer for a long PDF.

## 2026.11.4

- With a large font or a small screen, "Datei auswählen" no longer covers "Bericht kopieren" on the start screen.
- Colour photos can print like Dell's own driver: smooth, without a grid of dots, with deep black. Measure Dell's driver once on a Mac with `scripts/dell-engine.ts` and put the file into `/share/print-buddy/`; see the documentation. Print Buddy then sends colour photos as the printer's own data. Without the file, nothing changes.
- After "Drucken" the app shows how far the job has got: "Wird hochgeladen", "Wird vorbereitet … Blatt 2 von 5", "Wird an den Drucker geschickt". "Abbrechen" stops it while it is being prepared.
- A job can now be cancelled while it prints, too, not only while it waits. What the printer already has may still come out.
- "Nochmal drucken" asks before it prints.
- The buttons sit at the bottom of every screen, within reach of the thumb with the phone in one hand, and "Jetzt drucken?" and "Nochmal drucken?" open at the bottom edge.

## 2026.11.3

- A new icon: a smiling printer. It greets you on the start screen, too, with "PDFs und Fotos vom Handy drucken" underneath. The Home Assistant app store shows it as well.
- "Datei auswählen" is now at the bottom of the start screen, where the thumb reaches it with the phone in one hand.

## 2026.11.2

- With only one page or one photo, the options screen leaves out what there is nothing to choose from: the small pictures, "Alle" and "Keine", and the ‹ › arrows under the preview. The arrows also go away whenever everything chosen fits on one sheet.
- Swipe the preview to the left for the next sheet and to the right for the one before, like the ‹ › arrows. When the preview is zoomed in, dragging moves the picture as before.

## 2026.11.1

- No more waiting after picking or sharing a file: the options screen opens at once, and the file goes to Print Buddy in the background. Until it is there, "Drucken" reads "Wird hochgeladen … 60 %".
- "‹ Zurück" at the top of the options screen goes back to the start and forgets the file.
- PDFs start in colour ("Dokument Farbe"), and that preset comes first. A preset starred on a phone stays that phone's default.
- The options screen is less crowded: print size and position sit side by side, and nothing hides behind the "Drucken" bar any more.
- The row of presets has no scrollbar; a faded edge shows that more presets follow, and the chosen one is in view when the screen opens.

## 2026.11.0

- First release. Print a PDF or up to 20 photos (JPG, PNG) from the phone on the household printer: pick the files in the app, or share them from another app once Print Buddy is installed from Chrome.
- One required option, `printer_name`: the name of the CUPS queue. Home Assistant asks for it before the first start.
- A preview of every sheet, with print size, position, rotation, a choice of pages or photos, two pages per sheet, copies, colour, paper (A4, A5, Umschlag DL, Umschlag C5) and "Toner sparen". Sets of these can be saved as presets.
- "Jetzt drucken?" names the sheet count before any paper is used. The status screen follows the job, and a job that still waits can be cancelled.
- Each job keeps its files for 7 days under `/share/print-buddy/jobs/`. "Bericht kopieren" copies a report for when something goes wrong.
