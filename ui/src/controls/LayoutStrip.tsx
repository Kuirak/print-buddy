import { For } from "solid-js"
import type { Margins } from "../../../shared/api.ts"
import { cells, type Size } from "../../../shared/layout.ts"
import type { Layout } from "../../../shared/print-options.ts"
import { FadingRow } from "./FadingRow.tsx"

/** One tile of the strip: a layout and the short word under its sketch. */
export type LayoutChoice = { layout: Layout; label: string }

/** `Normal` and `2×` to `8×`: the grids, for PDFs and photos. */
export const gridChoices: readonly LayoutChoice[] = ([1, 2, 4, 6, 8] as const).map(perSheet => ({
  layout: { kind: "grid", perSheet },
  label: perSheet === 1 ? "Normal" : `${perSheet}×`,
}))

/** Whether `layout` is what a tile stands for: the same grid, or the same Photo format, whatever its Lage and switches. */
function standsFor(tile: Layout, layout: Layout) {
  if (tile.kind === "grid") return layout.kind === "grid" && layout.perSheet === tile.perSheet
  if (layout.kind === "grid") return false
  return typeof tile.format === "string" ? layout.format === tile.format : typeof layout.format !== "string"
}

const noMargins: Margins = { top: 0, right: 0, bottom: 0, left: 0 }

/**
 * How a sheet is divided, as a row of small drawings of the sheet (see `FadingRow`): one tile per choice, each the
 * sheet as the Printer feeds it with the Cells the layout module gives it on the chosen paper. A choice that gives no
 * Cells on that paper is greyed out and can't be picked.
 */
export function LayoutStrip(props: {
  choices: readonly LayoutChoice[]
  value: Layout
  /** The paper's size in points, and the Printer's margins on it, once they are known. */
  paper: Size
  margins: Margins | undefined
  /** The grids are read the other way: see `landscapeFirst`. */
  landscape: boolean
  onChange: (layout: Layout) => void
}) {
  return (
    <FadingRow role="radiogroup" label="Aufteilung">
      <For each={props.choices}>
        {choice => {
          const drawn = () => cells(choice.layout, props.paper, props.margins ?? noMargins, props.landscape).cells
          const chosen = () => standsFor(choice.layout, props.value)
          return (
            <button
              type="button"
              role="radio"
              aria-checked={chosen() ? "true" : "false"}
              disabled={drawn().length === 0}
              class={`flex w-16 shrink-0 cursor-pointer flex-col items-center gap-1 rounded-lg border-2 p-1 text-xs font-semibold whitespace-nowrap disabled:cursor-default disabled:opacity-30 ${chosen() ? "border-brand" : "border-transparent"}`}
              onClick={() => props.onChange(structuredClone(choice.layout))}
            >
              <svg aria-hidden="true" class="h-14" viewBox={`0 0 ${props.paper.width} ${props.paper.height}`}>
                <rect width={props.paper.width} height={props.paper.height} fill="white" stroke="#bbb" stroke-width={props.paper.width / 40} />
                <For each={drawn()}>
                  {cell => {
                    // a little apart, so that Cells that touch show as separate
                    const inset = props.paper.width / 60
                    const { left, top, width, height } = cell.box
                    return <rect x={left + inset} y={top + inset} width={width - 2 * inset} height={height - 2 * inset} fill="#cfe0f7" />
                  }}
                </For>
              </svg>
              {choice.label}
            </button>
          )
        }}
      </For>
    </FadingRow>
  )
}
