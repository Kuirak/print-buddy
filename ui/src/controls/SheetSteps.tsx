/**
 * Steps the preview through the sheets that will print, and says which one is on the screen.
 * `count` is the number of sheets for one copy.
 */
export function SheetSteps(props: {
  /** The sheet in the preview, counted from 0. */
  index: number
  count: number
  /** What is on that sheet and which of how many it is, or that there is none. */
  text: string
  onChange: (index: number) => void
}) {
  const button = "size-10 cursor-pointer rounded-lg border border-gray-300 text-xl font-semibold disabled:cursor-default disabled:opacity-40"
  return (
    <div class="flex items-center justify-center gap-3">
      <button type="button" class={button} aria-label="Vorheriges Blatt" disabled={props.index <= 0} onClick={() => props.onChange(props.index - 1)}>
        ‹
      </button>
      <span role="status" aria-label="Blatt in der Vorschau" class="min-w-32 text-center whitespace-nowrap">{props.text}</span>
      <button type="button" class={button} aria-label="Nächstes Blatt" disabled={props.index >= props.count - 1} onClick={() => props.onChange(props.index + 1)}>
        ›
      </button>
    </div>
  )
}
