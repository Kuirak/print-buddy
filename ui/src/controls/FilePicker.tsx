/** "Datei auswählen": opens the phone's file picker for one PDF or several photos. */
export function FilePicker(props: { onPick: (files: File[]) => void }) {
  return (
    <label class="btn-primary">
      Datei auswählen
      <input
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        multiple
        class="sr-only"
        onChange={event => {
          const files = [...(event.currentTarget.files ?? [])]
          // empty the field, so that picking the same file again counts as a change
          event.currentTarget.value = ""
          if (files.length > 0) props.onPick(files)
        }}
      />
    </label>
  )
}
