# Changelog

Newest first. Versions are `YYYY.MM.N`: year, month, and a counter that starts at 0 each month. Changes collect under "Unreleased" until the next release gives them a version.

## Unreleased

- A new icon: a smiling printer. It greets you on the start screen, too, with "PDFs und Fotos vom Handy drucken" underneath.
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
