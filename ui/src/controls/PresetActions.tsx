import { createSignal, Match, Show, Switch } from "solid-js"
import { isBuiltIn, type Preset, type Presets, type PresetValues } from "../presets.ts"

/**
 * Save the current settings as an own Preset, star the Preset they match, or delete it.
 * Starring needs a matching Preset and deleting an own one, so those buttons come and go.
 */
export function PresetActions(props: { presets: Presets; options: PresetValues; onPick: (preset: Preset) => void }) {
  const [asking, setAsking] = createSignal<"name" | "delete">()
  const [name, setName] = createSignal("")
  const active = () => props.presets.matching(props.options)
  const action = "min-h-11 cursor-pointer rounded-lg border border-gray-300 px-3 py-2 font-semibold disabled:cursor-default disabled:opacity-60"

  function close() {
    setAsking(undefined)
    setName("")
  }

  return (
    <Switch>
      <Match when={asking() === "name"}>
        <form
          class="flex flex-col gap-2"
          onSubmit={event => {
            event.preventDefault()
            const trimmed = name().trim()
            if (!trimmed) return
            props.presets.save(trimmed, props.options)
            close()
          }}
        >
          <label class="flex flex-col gap-1">
            Name der Voreinstellung (z. B. "Bastelpapier")
            <input
              type="text"
              class="min-h-11 rounded-lg border border-gray-300 px-3"
              value={name()}
              onInput={event => setName(event.currentTarget.value)}
            />
          </label>
          <div class="flex gap-2">
            <button type="submit" class={action}>Speichern</button>
            <button type="button" class={action} onClick={close}>Abbrechen</button>
          </div>
        </form>
      </Match>
      <Match when={asking() === "delete" && active()}>
        {preset => (
          <div class="flex flex-wrap items-center gap-2">
            <span class="mr-auto">Voreinstellung löschen?</span>
            <button
              type="button"
              class={action}
              onClick={() => {
                // the job goes on with the default Preset, as a new file would
                props.onPick(props.presets.remove(preset()))
                close()
              }}
            >
              Löschen
            </button>
            <button type="button" class={action} onClick={close}>Abbrechen</button>
          </div>
        )}
      </Match>
      <Match when={true}>
        <div class="flex flex-wrap gap-2">
          <button type="button" class={action} onClick={() => setAsking("name")}>Als Voreinstellung speichern …</button>
          <Show when={active()}>
            {preset => (
              <>
                <Show
                  when={props.presets.starred().id !== preset().id}
                  fallback={<button type="button" class={action} disabled>★ Standard</button>}
                >
                  <button type="button" class={action} onClick={() => props.presets.star(preset())}>Als Standard festlegen</button>
                </Show>
                <Show when={!isBuiltIn(preset())}>
                  <button type="button" class={action} onClick={() => setAsking("delete")}>Löschen</button>
                </Show>
              </>
            )}
          </Show>
        </div>
      </Match>
    </Switch>
  )
}
