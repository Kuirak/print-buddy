import { loginPath } from "../../../shared/login.ts"
import { ThumbScreen } from "../controls/ThumbScreen.tsx"
import { phoneFiles } from "../phone-files.ts"

/**
 * Shown when Cloudflare Access no longer lets the app's calls through: the monthly login has run out.
 * "Neu anmelden" leaves the app with a full page load, because only a page load can show the Cloudflare
 * login. After it the browser comes back and the app opens anew. It first waits for a phone's copy of the files still
 * being written, which the page load would cut off.
 */
export function LoginExpiredScreen() {
  return (
    <ThumbScreen
      actions={
        <button type="button" class="btn-primary" onClick={() => void phoneFiles.settled().then(() => location.assign(loginPath))}>
          Neu anmelden
        </button>
      }
    >
      <h1 class="text-xl font-bold">Anmeldung abgelaufen</h1>
    </ThumbScreen>
  )
}
