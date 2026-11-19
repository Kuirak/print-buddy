# Fixed addresses for the installed app

`/manifest.webmanifest`, `/sw.js`, `/icon-192.png`, `/icon-512.png` and `/icon-maskable-512.png` are never renamed. Android keeps these addresses for an installed app, and the Cloudflare Bypass fallback in the README lists exactly these paths. A new icon replaces the files' contents under the same names.

## Consequences

These files always come from the server, never from the service worker's cache. So the app shows its logo through `ui/src/controls/Logo.tsx`, an inline copy of `icon.svg`, rather than an `<img>` of the icon, which would be missing when the page comes from the cache without a network.
