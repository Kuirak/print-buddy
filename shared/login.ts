// The way back in after the Cloudflare Access login has run out, for the app and the server.

/**
 * Where "Neu anmelden" sends the browser. The service worker answers the app's own page from its
 * cache, so that page never reaches Cloudflare. This address always does: Cloudflare Access shows its
 * login for it and afterwards sends the browser back to it.
 */
export const loginPath = "/login"

/** In the app's address after the login. It tells the app to go on where the person was. */
export const loggedInParam = "logged-in"

/** Where the server sends the browser from `loginPath`. */
export const afterLoginPath = `/?${loggedInParam}=1`
