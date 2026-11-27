// The few icons the app draws itself: one stroke width and round ends, in the colour of the text beside them.
// They stand where a glyph from the font (⚠, ⛔, ★, ✎) would, which some phones draw as an empty box.

const stroke = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "2.5",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "aria-hidden": "true",
} as const

/** Something is not as it should be, but the Print Job can go on: a triangle with an exclamation mark. */
export function WarningIcon(props: { class?: string }) {
  return (
    <svg {...stroke} class={props.class}>
      <path d="M12 3 2.5 20h19L12 3Z" />
      <path d="M12 10v4.5M12 17.5v.01" />
    </svg>
  )
}

/** The Print Job can't go on: a circle with a bar across. */
export function StopIcon(props: { class?: string }) {
  return (
    <svg {...stroke} class={props.class}>
      <circle cx="12" cy="12" r="9" />
      <path d="M7.5 12h9" />
    </svg>
  )
}

/** The Preset a new file starts from: a filled star, with rounded points. */
export function StarIcon(props: { class?: string }) {
  return (
    <svg {...stroke} fill="currentColor" stroke-width="1.5" class={props.class}>
      <path d="M12 2.8 14.9 9l6.6.9-4.8 4.6 1.2 6.6L12 17.7l-5.9 3.4 1.2-6.6L2.5 9.9 9.1 9 12 2.8Z" />
    </svg>
  )
}

/** Own settings, which no Preset has: a pencil. */
export function PencilIcon(props: { class?: string }) {
  return (
    <svg {...stroke} class={props.class}>
      <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z" />
    </svg>
  )
}
