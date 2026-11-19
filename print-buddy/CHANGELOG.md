# Changelog

Newest first. Versions are `YYYY.MM.N`: year, month, and a counter that starts at 0 each month.

## 2026.11.0

- One required option, `printer_name`: the name of the CUPS queue. Home Assistant asks for it before the first start.
- First release. Print a PDF or up to 20 photos (JPG, PNG) from the phone on the household printer: pick the files in the app, or share them from another app once Print Buddy is installed from Chrome.
- A preview of every sheet, with print size, position, rotation, a choice of pages or photos, two pages per sheet, copies, colour, paper (A4, A5, Umschlag DL, Umschlag C5) and "Toner sparen". Sets of these can be saved as presets.
- "Jetzt drucken?" names the sheet count before any paper is used. The status screen follows the job, and a job that still waits can be cancelled.
- Each job keeps its files for 7 days under `/share/print-buddy/jobs/`. "Bericht kopieren" copies a report for when something goes wrong.
