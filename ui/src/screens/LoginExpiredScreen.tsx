/** Shown when Cloudflare Access no longer lets the app's calls through: the monthly login has run out. */
export function LoginExpiredScreen(props: { onLogin: () => void }) {
  return (
    <main class="flex flex-col gap-6 p-4">
      <h1 class="text-xl font-bold">Anmeldung abgelaufen</h1>
      <button type="button" class="btn-primary" onClick={() => props.onLogin()}>
        Neu anmelden
      </button>
    </main>
  )
}
