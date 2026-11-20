// Seam 3 helpers: what a person taps on the options screen in nearly every test.
import { screen, waitFor, within } from "@solidjs/testing-library"
import type { UserEvent } from "@testing-library/user-event"
import { expect } from "vitest"
import type { Item } from "../../../shared/print-options.ts"

/** The `items` of Print Options: how often each page or photo prints, in the file's order. None is turned. */
export const items = (...counts: number[]): Item[] => counts.map(count => ({ count, turn: 0 }))

/** The "Jetzt drucken?" confirmation, which has to be open. */
export const confirmation = () => screen.getByRole("dialog", { name: "Jetzt drucken?" })

/** Waits until the file is laid out: the upload is done and the margins have arrived, so Drucken can be tapped. */
export async function laidOut() {
  await waitFor(() => expect(screen.getByRole("button", { name: "Drucken" })).toBeEnabled())
}

/** Taps Drucken on the options screen, then Drucken in the confirmation: the Print Job is sent. */
export async function printAndConfirm(user: UserEvent) {
  await user.click(await screen.findByRole("button", { name: "Drucken" }))
  await user.click(within(confirmation()).getByRole("button", { name: "Drucken" }))
}

/** Taps "Ändern": opens the detailed controls (copies, colour, paper, quality, pages per sheet, the Preset actions). */
export async function openDetails(user: UserEvent) {
  await user.click(await screen.findByRole("button", { name: "Ändern" }))
}

/** Taps "Fertig" in the detailed controls: back on the options screen. */
export async function closeDetails(user: UserEvent) {
  await user.click(within(screen.getByRole("dialog", { name: "Einstellungen" })).getByRole("button", { name: "Fertig" }))
}
