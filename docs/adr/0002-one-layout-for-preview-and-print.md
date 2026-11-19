# Print Buddy renders the final PDF itself

The server never sends an uploaded file to CUPS. The renderer builds a new PDF for every Print Job, PDFs and photos alike, and `layout()` in `shared/layout.ts` decides where every page or photo sits on it. The options screen's preview, the cut-off warning, the confirmation's sheet count and the renderer all use that one function and add no geometry of their own. A test print on the household queue showed that CUPS ignores `scaling` on PDFs. A page sent with 50 % and one with 200 % both printed as fit, so CUPS can't apply the Print size. Two pages per sheet is rendered as two halves of the sheet too, although CUPS `number-up=2` works on the queue. With `number-up` the preview could only imitate what CUPS does.

## Consequences

- CUPS gets the PDF plus collated `copies`, `ColorMode`, `PageSize`, `Quality` and `MediaType`. It never gets `scaling`, `page-ranges` or `number-up`. Any other new option is drawn into the PDF. That means a change to the layout module or the renderer, not one more IPP attribute.
- The confirmation's sheet count and the server's `sheets` can't differ, because they are the same function over the same layout.
- `print.pdf` in the job folder is exactly what CUPS got.
