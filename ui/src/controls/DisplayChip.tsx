/** A chip that only shows something, such as a setting in the confirmation: plain grey, 28 px tall, no circle, nothing to tap. */
export function DisplayChip(props: { text: string }) {
  return <span class="inline-flex h-7 items-center rounded-full bg-gray-100 px-3 text-sm whitespace-nowrap">{props.text}</span>
}
