# The files of a Print Job stay on the phone

The app keeps the phone's copy of the files of the Print Job in progress until the person leaves the Print Job. Every way to print uploads that copy into a new draft. The ways are a share, "Datei auswählen", "Nochmal drucken", "Erneut versuchen" and a Print Job after the login. The server keeps no shared file outside a draft, and the submit of a draft uses it up. The phone's copy is one IndexedDB record, `phoneFiles`, so it survives the full page load of the Cloudflare login and works over plain HTTP too.

## Consequences

- "Nochmal drucken" and "Erneut versuchen" upload the files again.
- A share that reaches the server instead of the service worker is lost, and the app asks to share again.
- Every new way into a job goes through `phoneFiles.keep()` and `openHeld()`, and every way out through `leaveJob()`.
