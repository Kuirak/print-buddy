import { render, screen, within } from "@solidjs/testing-library"
import { userEvent } from "@testing-library/user-event"
import { createSignal } from "solid-js"
import { expect, test } from "vitest"
import { ChoiceGroup } from "./controls/ChoiceGroup.tsx"
import { DisplayChip } from "./controls/DisplayChip.tsx"
import { ToggleChip } from "./controls/ToggleChip.tsx"

const sizes = [
  { value: "fit", label: "Einpassen" },
  { value: "fill", label: "Füllen" },
  { value: "100", label: "100 %" },
] as const
type Size = (typeof sizes)[number]["value"]

/** A chip of the one-of row "Größe". */
const size = (name: string) => within(screen.getByRole("radiogroup", { name: "Größe" })).getByRole("radio", { name })

test("a one-of row shows which value is chosen, and a tap chooses another", async () => {
  const user = userEvent.setup()
  const [value, setValue] = createSignal<Size>("fit")
  render(() => <ChoiceGroup label="Größe" choices={sizes} value={value()} onChange={setValue} />)

  expect(size("Einpassen")).toBeChecked()
  expect(size("Füllen")).not.toBeChecked()
  expect(size("100 %")).not.toBeChecked()

  await user.click(size("Füllen"))
  expect(size("Füllen")).toBeChecked()
  expect(size("Einpassen")).not.toBeChecked()
})

test("a one-of row marks every value in use, and none as chosen, while pages or photos differ", async () => {
  const user = userEvent.setup()
  const [value, setValue] = createSignal<Size | undefined>(undefined)
  render(() => <ChoiceGroup label="Größe" choices={sizes} value={value()} inUse={value() === undefined ? ["fit", "100"] : []} onChange={setValue} />)

  expect(size("Einpassen")).toHaveAccessibleDescription("bei einigen")
  expect(size("100 %")).toHaveAccessibleDescription("bei einigen")
  expect(size("Füllen")).not.toHaveAccessibleDescription()
  for (const name of ["Einpassen", "Füllen", "100 %"]) expect(size(name)).not.toBeChecked()

  // choosing one for all ends the mixed state
  await user.click(size("100 %"))
  expect(size("100 %")).toBeChecked()
  for (const name of ["Einpassen", "Füllen", "100 %"]) expect(size(name)).not.toHaveAccessibleDescription()
})

test("an on/off chip shows on and off, and a tap switches it", async () => {
  const user = userEvent.setup()
  const [on, setOn] = createSignal(false)
  render(() => <ToggleChip label="Schnittlinien" state={on() ? "on" : "off"} onChange={setOn} />)
  const chip = screen.getByRole("switch", { name: "Schnittlinien" })

  expect(chip).not.toBeChecked()
  await user.click(chip)
  expect(chip).toBeChecked()
  await user.click(chip)
  expect(chip).not.toBeChecked()
})

test("an on/off chip that only some pages or photos have is mixed, and a tap switches it on for all", async () => {
  const user = userEvent.setup()
  const [state, setState] = createSignal<"on" | "off" | "mixed">("mixed")
  render(() => <ToggleChip label="Schnittlinien" state={state()} onChange={on => setState(on ? "on" : "off")} />)
  const chip = screen.getByRole("switch", { name: "Schnittlinien" })

  expect(chip).toHaveAttribute("aria-checked", "mixed")
  expect(chip).toHaveAccessibleDescription("bei einigen")

  await user.click(chip)
  expect(chip).toBeChecked()
  expect(chip).not.toHaveAccessibleDescription()
})

test("a display-only chip shows its text and is nothing to tap", () => {
  render(() => <DisplayChip text="Toner sparen" />)

  expect(screen.getByText("Toner sparen")).toBeVisible()
  for (const role of ["button", "switch", "radio", "checkbox"]) expect(screen.queryByRole(role)).toBeNull()
})
