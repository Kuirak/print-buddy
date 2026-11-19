import { render, screen } from "@solidjs/testing-library"
import { expect, test } from "vitest"
import pageHtml from "../index.html?raw"
import manifestText from "../public/manifest.webmanifest?raw"
import { App } from "./App.tsx"
import { handledBy } from "./share-target.ts"
import { fakeServiceWorker } from "./testing/fake-service-worker.ts"
import { json, mockApi, type ApiCall } from "./testing/mock-api.ts"
import { share } from "./testing/share.ts"

/** The files the app uploaded to a draft, in upload order. */
const uploaded = (calls: ApiCall[], draftId: string) =>
  calls.filter(call => call.path === `/api/drafts/${draftId}/files`).map(call => (call.body as FormData).get("file") as File)

test("a shared PDF opens straight into the options screen", async () => {
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json({ kind: "pdf", pageCount: 1, pages: [{ width: 595, height: 842 }] }, 201),
  })

  await share([new File(["%PDF-1.4 shared"], "Rechnung.pdf", { type: "application/pdf" })])
  render(() => <App />)

  expect(await screen.findByText("Rechnung.pdf")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Drucken" })).toBeInTheDocument()
  const [file] = uploaded(api.calls, "d1")
  expect(file!.name).toBe("Rechnung.pdf")
  expect(await file!.text()).toBe("%PDF-1.4 shared")
  // the share itself is answered on the phone: only the app's own API calls reach the network (the options screen also reads the Printer)
  expect(api.calls.filter(call => call.method === "POST").map(call => call.path)).toEqual(["/api/drafts", "/api/drafts/d1/files"])
})

const photoFacts = { kind: "photo", format: "jpeg", width: 4000, height: 3000, orientation: 1 }
const photo = (name: string) => new File(["\xff\xd8\xff", name], name, { type: "image/jpeg" })
const pdf = (name: string) => new File(["%PDF-1.4"], name, { type: "application/pdf" })

test("shared photos are uploaded one per request in the order they were shared", async () => {
  const api = mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json(photoFacts, 201),
  })

  await share([photo("IMG_3.jpg"), photo("IMG_1.jpg"), photo("IMG_2.jpg")])
  render(() => <App />)

  expect(await screen.findByText("3 Fotos")).toBeInTheDocument()
  expect(uploaded(api.calls, "d1").map(file => file.name)).toEqual(["IMG_3.jpg", "IMG_1.jpg", "IMG_2.jpg"])
})

test.each([
  ["several PDFs", [pdf("a.pdf"), pdf("b.pdf")], { refusal: "one-pdf-only" }, 409, "Bitte jeweils nur eine Datei teilen"],
  ["a PDF mixed with photos", [photo("IMG_1.jpg"), pdf("a.pdf")], { refusal: "mixed-types" }, 409, "Bitte jeweils nur eine Datei teilen"],
  [
    "more than 20 photos",
    Array.from({ length: 21 }, (_, i) => photo(`IMG_${i + 1}.jpg`)),
    { refusal: "too-many-photos" },
    409,
    "Höchstens 20 Fotos auf einmal",
  ],
  [
    "an unsupported type",
    [new File(["ftypheic"], "IMG_1.heic", { type: "image/heic" })],
    { refusal: "unsupported-type" },
    415,
    "Diese Datei kann Print Buddy nicht drucken. Möglich sind PDF, JPG und PNG.",
  ],
])("a share the intake refuses (%s) ends on the Refusal screen", async (_what, files, refusal, status, message) => {
  // the server refuses the file that breaks the rule, which is the last one of each set
  let uploads = 0
  mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => (++uploads === files.length ? json(refusal, status) : json(photoFacts, 201)),
  })

  await share(files)
  render(() => <App />)

  expect(await screen.findByText(message)).toBeInTheDocument()
  expect(screen.getByLabelText("Datei auswählen")).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Drucken" })).not.toBeInTheDocument()
})

test("a share that arrives without files says Bitte nochmal teilen, offers Datei auswählen and uploads nothing", async () => {
  const api = mockApi({})

  await share([])
  render(() => <App />)

  expect(await screen.findByRole("heading", { name: "Bitte nochmal teilen" })).toBeInTheDocument()
  expect(screen.getByLabelText("Datei auswählen")).toBeInTheDocument()
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(api.calls.map(call => `${call.method} ${call.path}`)).toEqual(["GET /api/session"])
  expect(location.search).toBe("")
})

test("while shared files are on their way to the server, the Start screen's Datei auswählen is not offered", async () => {
  let accept!: (answer: Response) => void
  mockApi({
    "POST /api/drafts": () => new Promise<Response>(resolve => { accept = resolve }),
    "POST /api/drafts/d1/files": () => json({ kind: "pdf", pageCount: 1, pages: [{ width: 595, height: 842 }] }, 201),
  })

  await share([pdf("Rechnung.pdf")])
  render(() => <App />)

  await expect.poll(() => accept).toBeDefined()
  expect(screen.getByRole("heading", { name: "Print Buddy" })).toBeInTheDocument()
  expect(screen.queryByLabelText("Datei auswählen")).not.toBeInTheDocument()

  accept(json({ draftId: "d1" }, 201))
  expect(await screen.findByText("Rechnung.pdf")).toBeInTheDocument()
})

test("the manifest makes the app installable, in German, with its icons", () => {
  const manifest = JSON.parse(manifestText)

  expect(manifest).toMatchObject({ name: "Print Buddy", short_name: "Print Buddy", lang: "de", display: "standalone", start_url: "/", scope: "/" })
  expect(manifest.icons).toEqual(expect.arrayContaining([
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  ]))
  // every icon the manifest names is a file the build ships
  const shipped = Object.keys(import.meta.glob("../public/*.png")).map(path => path.replace("../public", ""))
  expect(shipped).toEqual(expect.arrayContaining(manifest.icons.map((icon: { src: string }) => icon.src)))
})

test("the manifest declares the share target: a multipart POST of PDF, JPEG and PNG files", () => {
  expect(JSON.parse(manifestText).share_target).toEqual({
    action: "/share-target",
    method: "POST",
    enctype: "multipart/form-data",
    params: {
      files: [{ name: "file", accept: ["application/pdf", ".pdf", "image/jpeg", ".jpg", ".jpeg", "image/png", ".png"] }],
    },
  })
})

test("the page links the manifest with credentials, so that Cloudflare Access lets the browser fetch it", () => {
  const link = new DOMParser().parseFromString(pageHtml, "text/html").querySelector('link[rel="manifest"]')

  expect(link?.getAttribute("href")).toBe("/manifest.webmanifest")
  expect(link?.getAttribute("crossorigin")).toBe("use-credentials")
})

const get = (path: string) => new Request(new URL(path, location.href))
const post = (path: string) => new Request(new URL(path, location.href), { method: "POST", body: "{}" })

test.each([
  [post("/share-target"), "share"],
  [get("/"), "shell"],
  [get("/?shared=1"), "shell"],
  [get("/assets/index-abc123.js"), "shell"],
  // API data always comes from the server
  [get("/api/session"), "network"],
  [get("/api/jobs/j1"), "network"],
  [get("/api/printer"), "network"],
  [post("/api/drafts"), "network"],
  [post("/api/drafts/d1/files"), "network"],
  [get("/health"), "network"],
  // so that a new version and a changed manifest are always seen
  [get("/sw.js"), "network"],
  [get("/manifest.webmanifest"), "network"],
  [get("/icon-192.png"), "network"],
  // a share that was lost to the login comes back as a GET, which the server answers
  [get("/share-target"), "network"],
  // the way to the Cloudflare login must reach Cloudflare: the app's page itself never does
  [get("/login"), "network"],
  [post("/"), "network"],
] as const)("the service worker answers %o as %s", (request, expected) => {
  expect(handledBy(request)).toBe(expected)
})

const shareHint = "Teile ein PDF oder Fotos aus einer anderen App mit Print Buddy."

test("where the app can be installed, the Start screen says that files can be shared with Print Buddy", () => {
  mockApi({})
  fakeServiceWorker()

  render(() => <App />)

  expect(screen.getByText(shareHint)).toBeInTheDocument()
  expect(screen.getByLabelText("Datei auswählen")).toBeInTheDocument()
})

test("over plain HTTP nothing can be shared, so the Start screen offers only Datei auswählen", () => {
  mockApi({})

  render(() => <App />)

  expect(screen.queryByText(shareHint)).not.toBeInTheDocument()
  expect(screen.getByLabelText("Datei auswählen")).toBeInTheDocument()
})
