# Colour photos print through Dell's engine

Printed through Dell's own macOS driver, the same photos come out smooth and with a deep black. Through the CUPS queue they show a visible grid of dots and a grey black. The queue drives the Printer with foo2hbpl2: its wrapper has Ghostscript separate RGB with a built-in press profile and screen every toner on one 130 lpi grid. No PPD or Ghostscript option the queue can be given changes that. We tested `halftone`, `ICM` (with Dell's own profile as well), `UseFastColor`, output profiles and `DITHERPPI` through the real filter chain, and Poppler's `pdftops` drops a halftone set in the PDF. Placing the toner dots ourselves in the PDF, as DeviceN, removed the grid but stayed grainy and pale. Two things make Dell's print different:

- **Colour under black.** Dell lays down black toner plus about half of each colour. The queue's foo2hbpl2 runs with `-A -B`, which never lets colour toner under black. Without them, a raw test page printed C+M+Y+K darker than K alone.
- **Pulse strengths.** Dell sends 2 bits per 600 dpi pixel and toner: no toner, or one of 3 laser pulse strengths. Each toner has a fixed threshold cell that tiles the page at its own angle (C and M 32 × 6 pixels, Y and K 36 × 6, each band of rows shifted). foo2hbpl2's own header already makes the Printer read the bits this way: on a test page, cyan `01` printed lighter than `10`, and that lighter than `11`.

Dell's driver is a Mach-O binary for macOS only, and Dell never made one for Linux. So `scripts/dell-engine.ts` measures it from the outside on a Mac where it is installed. It runs a chart of 4,913 grid colours and 4 ramps through Dell's filter with `cupsfilter`, decodes the output with `hbpldecode` from foo2zjs, and writes one file:

- the toner amount of every grid colour, 17 steps per channel;
- per toner, the screen cell and the order in which its quanta (pixel × pulse strength) switch on.

The script finds the cells itself and refuses a driver whose output is not one fixed threshold cell per toner. A photo rendered from the file matched Dell's own output in 98–99 % of all toner codes; the rest were one strength apart.

The file is Dell's data. It never goes into the repository or the image: it lives in the add-on's share folder as `/share/print-buddy/dell-engine.json`. When it is there, the renderer turns a colour photo Print Job into the Printer's raster through it, row by row at 600 dpi (`server/dell-engine.ts`). foo2hbpl2, built into the image, packs the raster into HBPL without `-A -B` (`server/printer/hbpl.ts`). The job goes to the same CUPS queue as `application/vnd.cups-raw`, so CUPS passes it on as it is and job status and cancel keep working.

## Consequences

- foo2hbpl2 is GPL-2.0. It stays a separate program the server runs; the image carries its source next to the binary.
- A raw job carries no PPD options. Copies are rendered into the data, the sheets in order and then again.
- The job folder keeps what CUPS got: `print.hbpl` for these jobs, `print.pdf` for all others.
- A full-page colour photo takes about 4 s on a laptop and gives about 8 MB of HBPL.
- Without the file, colour photos go through the queue's driver like everything else, grid included. Black and white Print Jobs and PDFs always do.
- The file is measured from one driver version (Dell C1765nfw v1.085, image type Normal). After a driver update, run the script again.
- Raw printing only works because the queue's printer is this Dell. Another printer would print the data as garbage, so the file must only be placed for this one.
