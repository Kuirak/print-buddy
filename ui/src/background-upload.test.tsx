import { render, screen } from "@solidjs/testing-library"
import { userEvent } from "@testing-library/user-event"
import { expect, test } from "vitest"
import { App } from "./App.tsx"
import { phoneFiles } from "./phone-files.ts"
import { json, mockApi } from "./testing/mock-api.ts"

const pdfFacts = { kind: "pdf", pageCount: 1, pages: [{ width: 595, height: 842 }] }
const pdf = (name: string) => new File(["%PDF-1.4"], name, { type: "application/pdf" })

test("Zurück on the options screen goes back to Start, and the phone's copy is gone", async () => {
  mockApi({
    "POST /api/drafts": () => json({ draftId: "d1" }, 201),
    "POST /api/drafts/d1/files": () => json(pdfFacts, 201),
  })
  const user = userEvent.setup()
  render(() => <App />)
  await user.upload(screen.getByLabelText("Datei auswählen"), pdf("Rechnung.pdf"))
  await screen.findByText("Rechnung.pdf")

  await user.click(screen.getByRole("button", { name: "Zurück" }))

  expect(await screen.findByLabelText("Datei auswählen")).toBeInTheDocument()
  expect(screen.queryByText("Rechnung.pdf")).not.toBeInTheDocument()
  expect(await phoneFiles.held()).toEqual([])
})
