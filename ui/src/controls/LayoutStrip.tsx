import { For, Show } from "solid-js"
import type { Margins } from "../../../shared/api.ts"
import { cells, type Size } from "../../../shared/layout.ts"
import type { FormatLayout, Layout } from "../../../shared/print-options.ts"
import { formatNames, layoutName } from "../job-text.ts"
import { FadingRow } from "./FadingRow.tsx"

/**
 * One tile of the strip: a layout and the short word under its sketch. `own` is the own size: drawn as "mm" and never
 * greyed out, as its inputs say what doesn't fit.
 */
export type LayoutChoice = { layout: Layout; label: string; own?: true }

/** `Normal` and `2×` to `8×`: the grids, for PDFs and photos. */
export const gridChoices: readonly LayoutChoice[] = ([1, 2, 4, 6, 8] as const).map(perSheet => {
  const layout = { kind: "grid", perSheet } as const
  return { layout, label: layoutName(layout) }
})

/**
 * `10×15`, `9×13`, `13×18`, `Passbild` and `Eigenes`, for photos only: each with the Lage and the switches given,
 * so that changing the format keeps them. `own` is the own size in mm.
 */
export function formatChoices(switches: Pick<FormatLayout, "lage" | "gap" | "cutLines">, own: { w: number; h: number }): LayoutChoice[] {
  return [
    ...(Object.keys(formatNames) as (keyof typeof formatNames)[]).map(format => {
      const layout = { kind: "format", format, ...switches } as const
      return { layout, label: layoutName(layout) }
    }),
    { layout: { kind: "format", format: { ...own }, ...switches }, label: "Eigenes", own: true },
  ]
}

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
              aria-label={choice.label}
              aria-checked={chosen() ? "true" : "false"}
              disabled={!choice.own && drawn().length === 0}
              class={`flex w-16 shrink-0 cursor-pointer flex-col items-center gap-1 rounded-lg border-2 p-1 text-xs font-semibold whitespace-nowrap disabled:cursor-default disabled:opacity-30 ${chosen() ? "border-brand" : "border-transparent"}`}
              onClick={() => props.onChange(structuredClone(choice.layout))}
            >
              <svg aria-hidden="true" class="h-14" viewBox={`0 0 ${props.paper.width} ${props.paper.height}`}>
                <rect width={props.paper.width} height={props.paper.height} fill="white" stroke="#bbb" stroke-width={props.paper.width / 40} />
                <Show
                  when={!choice.own}
                  fallback={<text x={props.paper.width / 2} y={props.paper.height / 2} font-size={String(props.paper.width / 3.5)} text-anchor="middle" dominant-baseline="central" fill="#999">mm</text>}
                >
                  <For each={drawn()}>
                    {cell => {
                      // a little apart, so that Cells that touch show as separate
                      const inset = props.paper.width / 60
                      const { left, top, width, height } = cell.box
                      return <rect x={left + inset} y={top + inset} width={width - 2 * inset} height={height - 2 * inset} fill="#cfe0f7" />
                    }}
                  </For>
                </Show>
              </svg>
              {choice.label}
            </button>
          )
        }}
      </For>
    </FadingRow>
  )
}
