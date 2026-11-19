import type { ScreenState } from "../../shared/api.ts"

/** The German word for each state of a Print Job, as the status screen, the Start screen and the report show it. */
export const stateWords: Record<ScreenState, string> = {
  waiting: "Wartet",
  printing: "Wird gedruckt",
  done: "Fertig",
  cancelled: "Abgebrochen",
  error: "Fehler",
}
