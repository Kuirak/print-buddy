/**
 * The bar for the page or photo picked in the preview, in the place of the sheet stepper: turn it left or right, switch
 * it between Füllen and Einpassen, or close the bar. Everything here changes that one page or photo only.
 */
export function ItemBar(props: {
  /** "Seite 3" or "Foto 2". */
  name: string
  /** Its size as it prints now: "Füllen", "Einpassen", or the percentage for all. */
  size: string
  /** Turns it a quarter: 270 to the left, 90 to the right. */
  onTurn: (by: 90 | 270) => void
  /** Switches it from Füllen to Einpassen, and from anything else to Füllen. */
  onSize: () => void
  onClose: () => void
}) {
  const round = "h-11 flex-1 cursor-pointer rounded-full bg-white/15"
  return (
    <div role="toolbar" aria-label={props.name} class="flex w-full max-w-sm items-center gap-2 rounded-full bg-gray-900 p-1.5 text-white">
      <button type="button" class={`${round} text-xl`} aria-label="Nach links drehen" onClick={() => props.onTurn(270)}>↺</button>
      <button type="button" class={`${round} text-xl`} aria-label="Nach rechts drehen" onClick={() => props.onTurn(90)}>↻</button>
      <button type="button" class={`${round} text-sm font-semibold`} onClick={() => props.onSize()}>{props.size}</button>
      <button type="button" class="h-11 w-11 shrink-0 cursor-pointer rounded-full text-lg" aria-label="Schließen" onClick={() => props.onClose()}>✕</button>
    </div>
  )
}
