# Glossary

**Printer**: The household's Dell C1765nfw, as published by the CUPS server running on Home Assistant. The only print destination.

**Dell's engine**: How Dell's own driver turns colour into the Printer's toner: its colour table and its screens, measured from that driver by `scripts/dell-engine.ts`. It is Dell's data and lives only in the add-on's share folder. When it is there, colour Print Jobs, photos and PDFs, print through it.

**Print Job**: One PDF, or up to 20 photos, sent to the Printer together with one chosen set of Print Options.

**Print Options**: The choices a family member makes before a Print Job starts (copies, colour, paper, Print size, Position, which pages, Pages per sheet or Photos per sheet, Repeats).

**Copies**: How many times the whole Print Job comes out. Not to be confused with Repeats.

**Share-to-print**: Starting a Print Job by sharing a file from another Android app into Print Buddy, rather than opening Print Buddy first.

**Household network**: The home Wi-Fi/LAN. Anyone on it is trusted to print.

**Print size**: How large the file is printed on the sheet, as a percentage of its original size or fitted to or filling the sheet. Too large cuts content off; too small leaves part of the sheet empty.

**Position**: Where the content sits on the sheet: one of nine spots (corners, edge middles, centre). It decides where the empty part of the sheet ends up and, when the content is too large, which part is cut off.

**Preset**: A named set of Print Options that can be picked in one tap. Each person keeps their own presets and defaults.

**Cell**: One of the equal parts a sheet is divided into when it holds more than one page or photo. Each Cell holds one page or photo; Print size and Position apply inside the Cell, not the whole sheet.

**Pages per sheet**: How many PDF pages share one side of a sheet, each in its own Cell.

**Photos per sheet**: How many photos share one side of a sheet, each in its own Cell.

**Photo format**: A fixed size a photo is printed at, such as 10 × 15 cm, independent of the paper. The sheet then holds as many photos as fit. Not to be confused with Print size, which scales content relative to its own size or the sheet.

**Repeats**: How many times each selected page or photo appears on the sheets, side by side, within one copy of the Print Job. Four photos with 2 Repeats fill 8 Cells.
