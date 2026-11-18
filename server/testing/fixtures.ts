// Small files for tests. Keep them deterministic: no dates, no random ids.

/**
 * A valid one-page A4 PDF. The second line holds bytes above 0x7f, so a test notices
 * if the file is ever treated as text on its way to the printer.
 */
export function samplePdf(): Uint8Array<ArrayBuffer> {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>",
  ]
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n"), Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])]
  let length = chunks[0]!.length + chunks[1]!.length
  const offsets: number[] = []
  for (const [i, body] of objects.entries()) {
    offsets.push(length)
    const chunk = Buffer.from(`${i + 1} 0 obj\n${body}\nendobj\n`)
    chunks.push(chunk)
    length += chunk.length
  }
  const xref = offsets.map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("")
  chunks.push(Buffer.from(
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${xref}` +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`,
  ))
  return new Uint8Array(Buffer.concat(chunks))
}
