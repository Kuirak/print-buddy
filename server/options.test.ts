import assert from "node:assert/strict"
import { test } from "node:test"
import type { PrintOptions } from "../shared/print-options.ts"
import { Op, PrinterState, Tag, findAttr, values, type IppMessage } from "./printer/ipp-codec.ts"
import { samplePdf, samplePrintOptions as base } from "./testing/fixtures.ts"
import { startTestServer, type TestServer } from "./testing/harness.ts"

async function draftWithPdf(server: TestServer) {
  const { draftId } = await (await server.post("/api/drafts")).json() as { draftId: string }
  await server.upload(draftId, samplePdf(), "a.pdf", "application/pdf")
  return draftId
}

const jobAttr = (request: IppMessage, name: string) => values(request, Tag.job, name)

test("the Print Job carries the chosen copies, colour, paper and quality", async t => {
  const server = await startTestServer()
  t.after(server.close)

  const cases: { options: Partial<PrintOptions>; expected: Record<string, unknown> }[] = [
    { options: {}, expected: { copies: 1, ColorMode: "Monochrome", PageSize: "A4", Quality: "normal", MediaType: "plain" } },
    { options: { copies: 3 }, expected: { copies: 3 } },
    { options: { color: "color" }, expected: { ColorMode: "Color" } },
    { options: { color: "mono" }, expected: { ColorMode: "Monochrome" } },
    { options: { quality: "normal" }, expected: { Quality: "normal" } },
    { options: { quality: "draft" }, expected: { Quality: "draft" } },
    { options: { paper: "A4" }, expected: { PageSize: "A4", MediaType: "plain" } },
    { options: { paper: "A5" }, expected: { PageSize: "A5", MediaType: "plain" } },
    { options: { paper: "EnvDL" }, expected: { PageSize: "EnvDL", MediaType: "envelope" } },
    { options: { paper: "EnvC5" }, expected: { PageSize: "EnvC5", MediaType: "envelope" } },
  ]
  for (const { options, expected } of cases) {
    const submitted = await server.post(`/api/drafts/${await draftWithPdf(server)}/submit`, { ...base, ...options })
    assert.equal(submitted.status, 201, JSON.stringify(options))

    const request = server.printer.requests.at(-1)!
    assert.equal(request.code, Op.printJob)
    for (const [name, value] of Object.entries(expected)) {
      assert.deepEqual(jobAttr(request, name), [value], `${name} for ${JSON.stringify(options)}`)
    }
    assert.deepEqual(jobAttr(request, "multiple-document-handling"), ["separate-documents-collated-copies"])
    assert.deepEqual(values(request, Tag.operation, "requesting-user-name"), ["print-buddy"])
  }
  assert.equal(server.printer.requests.length, cases.length)
})

test("the PPD options go out as names, the way lp -o sends them", async t => {
  const server = await startTestServer()
  t.after(server.close)

  await server.post(`/api/drafts/${await draftWithPdf(server)}/submit`, base)

  const request = server.printer.requests.at(-1)!
  for (const name of ["ColorMode", "PageSize", "Quality", "MediaType"]) {
    assert.equal(findAttr(request, Tag.job, name)?.[0]?.tag, Tag.name, name)
  }
  assert.equal(findAttr(request, Tag.job, "copies")?.[0]?.tag, Tag.integer)
  assert.equal(findAttr(request, Tag.job, "multiple-document-handling")?.[0]?.tag, Tag.keyword)
})

test("the Print Job never carries scaling, page ranges or number-up", async t => {
  const server = await startTestServer()
  t.after(server.close)

  await server.post(`/api/drafts/${await draftWithPdf(server)}/submit`, {
    ...base, printSize: { kind: "percent", value: 50 }, layout: { kind: "grid", perSheet: 8 },
  })

  const names = server.printer.requests.at(-1)!.groups.flatMap(group => group.attributes.map(a => a.name))
  for (const forbidden of ["scaling", "page-ranges", "number-up", "fit-to-page", "print-scaling", "media", "media-col"]) {
    assert.ok(!names.includes(forbidden), forbidden)
  }
  assert.deepEqual(names.filter(name => !["attributes-charset", "attributes-natural-language", "printer-uri", "requesting-user-name", "job-name", "document-format"].includes(name)).sort(),
    ["ColorMode", "MediaType", "PageSize", "Quality", "copies", "multiple-document-handling"])
})

test("invalid Print Options are refused and no Print Job is sent", async t => {
  const server = await startTestServer()
  t.after(server.close)
  const draftId = await draftWithPdf(server)
  const format = { kind: "format", format: "10x15", lage: "save", gap: true, cutLines: false }

  const invalid: unknown[] = [
    undefined,
    "A4",
    [],
    { ...base, copies: 0 },
    { ...base, copies: -1 },
    { ...base, copies: 1.5 },
    { ...base, copies: "2" },
    { ...base, copies: 101 },
    { ...base, color: "sepia" },
    { ...base, paper: "A3" },
    { ...base, paper: undefined },
    { ...base, quality: "high" },
    { ...base, printSize: { kind: "percent" } },
    { ...base, printSize: { kind: "percent", value: 0 } },
    { ...base, printSize: "fit" },
    { ...base, position: "middle" },
    { ...base, layout: undefined },
    { ...base, layout: { kind: "grid", perSheet: 3 } },
    { ...base, layout: { kind: "grid" } },
    { ...base, layout: { kind: "pages", perSheet: 2 } },
    { ...base, layout: { ...format, format: "20x30" } },
    { ...base, layout: { ...format, format: { w: 19, h: 50 } } },
    { ...base, layout: { ...format, format: { w: 50, h: 19.9 } } },
    { ...base, layout: { ...format, format: { w: 50 } } },
    { ...base, layout: { ...format, lage: "auto" } },
    { ...base, layout: { ...format, gap: "yes" } },
    { ...base, layout: { ...format, cutLines: undefined } },
    { ...base, items: undefined },
    { ...base, items: "1-3" },
    { ...base, items: [] },
    { ...base, items: [{ count: 0, turn: 0 }] },
    { ...base, items: [{ count: 51, turn: 0 }] },
    { ...base, items: [{ count: -1, turn: 0 }] },
    { ...base, items: [{ count: 1.5, turn: 0 }] },
    { ...base, items: [{ count: 1, turn: 45 }] },
    { ...base, items: [{ count: 1 }] },
    { ...base, items: [{ count: 1, turn: 0, size: "percent" }] },
    { ...base, items: [{ count: 1, turn: 0 }, null] },
    { ...base, items: [{ count: 1, turn: 0, pan: { x: 1.1, y: 0 } }] },
    { ...base, items: [{ count: 1, turn: 0, pan: { x: 0, y: -0.1 } }] },
    { ...base, items: [{ count: 1, turn: 0, pan: { x: "0" } }] },
    { ...base, items: [{ count: 1, turn: 0, pan: null }] },
  ]
  for (const options of invalid) {
    const submitted = await server.post(`/api/drafts/${draftId}/submit`, options)
    assert.equal(submitted.status, 400, JSON.stringify(options))
    assert.deepEqual(await submitted.json(), { error: "invalid-options" })
  }
  const notJson = await server.request(`/api/drafts/${draftId}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" })
  assert.equal(notJson.status, 400)

  assert.equal(server.printer.requests.length, 0)
})

test("the printer info gives the printable margins of every paper and the printer state", async t => {
  const server = await startTestServer()
  t.after(server.close)

  const answer = await server.request("/api/printer")

  assert.equal(answer.status, 200)
  // the fake printer reports 3.18 mm left and right, 4.23 mm top and bottom; 1 pt = 25.4 / 72 mm
  const margins = { top: 11.99, right: 9.01, bottom: 11.99, left: 9.01 }
  assert.deepEqual(await answer.json(), {
    margins: { A4: margins, A5: margins, EnvDL: margins, EnvC5: margins },
    state: "idle",
    reasons: ["none"],
    message: "",
  })
})

test("each paper gets its own margins, matched by its size", async t => {
  const server = await startTestServer({
    beforeStart: printer => {
      // Letter first, then our four in another order than ours, sizes as cupsd derives them from PPD points
      printer.printer.media = [
        { width: 21590, height: 27940, top: 100, right: 100, bottom: 100, left: 100 },
        { width: 16193, height: 22895, top: 1000, right: 500, bottom: 1500, left: 2000 },
        { width: 20990, height: 29704, top: 423, right: 318, bottom: 423, left: 318 },
        { width: 11007, height: 22013, top: 600, right: 700, bottom: 800, left: 900 },
        { width: 14817, height: 20990, top: 254, right: 254, bottom: 254, left: 254 },
      ]
    },
  })
  t.after(server.close)

  const { margins } = await (await server.request("/api/printer")).json() as { margins: unknown }

  assert.deepEqual(margins, {
    A4: { top: 11.99, right: 9.01, bottom: 11.99, left: 9.01 },
    A5: { top: 7.2, right: 7.2, bottom: 7.2, left: 7.2 },
    EnvDL: { top: 17.01, right: 19.84, bottom: 22.68, left: 25.51 },
    EnvC5: { top: 28.35, right: 14.17, bottom: 42.52, left: 56.69 },
  })
})

test("the margins are read once at startup, by name, and then come from the cache", async t => {
  const server = await startTestServer()
  t.after(server.close)

  assert.equal(server.startupRequests.length, 1)
  const startup = server.startupRequests[0]!
  assert.equal(startup.code, Op.getPrinterAttributes)
  // CUPS leaves media-col-database out of `all`
  assert.ok(values(startup, Tag.operation, "requested-attributes").includes("media-col-database"))

  await server.request("/api/printer")
  await server.request("/api/printer")

  for (const request of server.printer.requests) {
    assert.ok(!values(request, Tag.operation, "requested-attributes").includes("media-col-database"))
  }
})

test("the printer info follows the printer's state", async t => {
  const server = await startTestServer()
  t.after(server.close)
  Object.assign(server.printer.printer, { state: PrinterState.stopped, reasons: ["media-empty-error", "paused"], message: "Kein Papier" })

  const info = await (await server.request("/api/printer")).json() as Record<string, unknown>

  assert.equal(info.state, "stopped")
  assert.deepEqual(info.reasons, ["media-empty-error", "paused"])
  assert.equal(info.message, "Kein Papier")

  server.printer.printer.state = PrinterState.processing
  assert.equal((await (await server.request("/api/printer")).json() as Record<string, unknown>).state, "processing")
})

const fallback = { top: 12, right: 9, bottom: 12, left: 9 }

test("without media-col-database the server starts with the fallback margins and warns", async t => {
  const warn = t.mock.method(console, "warn", () => {})
  const server = await startTestServer({ beforeStart: printer => { printer.printer.mediaColDatabase = false } })
  t.after(server.close)

  const info = await (await server.request("/api/printer")).json() as Record<string, unknown>

  assert.deepEqual(info.margins, { A4: fallback, A5: fallback, EnvDL: fallback, EnvC5: fallback })
  assert.equal(info.state, "idle")
  assert.equal(warn.mock.callCount(), 1)
  assert.match(String(warn.mock.calls[0]!.arguments[0]), /margins/)
})

test("a paper missing from media-col-database gets the fallback margins", async t => {
  const warn = t.mock.method(console, "warn", () => {})
  const server = await startTestServer({
    beforeStart: printer => { printer.printer.media = [{ width: 20990, height: 29704, top: 500, right: 500, bottom: 500, left: 500 }] },
  })
  t.after(server.close)

  const { margins } = await (await server.request("/api/printer")).json() as { margins: unknown }

  const a4 = { top: 14.17, right: 14.17, bottom: 14.17, left: 14.17 }
  assert.deepEqual(margins, { A4: a4, A5: fallback, EnvDL: fallback, EnvC5: fallback })
  assert.equal(warn.mock.callCount(), 1)
})

test("with CUPS unreachable the server still starts, with the fallback margins and an unknown state", async t => {
  const warn = t.mock.method(console, "warn", () => {})
  const server = await startTestServer({ beforeStart: printer => { printer.printer.failNext = 503 } })
  t.after(server.close)

  const first = await (await server.request("/api/printer")).json() as Record<string, unknown>
  assert.deepEqual(first.margins, { A4: fallback, A5: fallback, EnvDL: fallback, EnvC5: fallback })
  assert.equal(first.state, "idle")
  assert.equal(warn.mock.callCount(), 1)

  server.printer.printer.failNext = 503
  const second = await server.request("/api/printer")
  assert.equal(second.status, 200)
  assert.deepEqual(await second.json(), {
    margins: { A4: fallback, A5: fallback, EnvDL: fallback, EnvC5: fallback },
    state: "unknown",
    reasons: [],
    message: "",
  })
})
