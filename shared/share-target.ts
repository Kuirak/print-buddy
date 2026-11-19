// The share target's address and names, for the service worker, the app and the server.
// `ui/public/manifest.webmanifest` declares the first two to Android; a test keeps them equal.

/** Where Android POSTs a share: `share_target.action` in the manifest. */
export const shareTargetPath = "/share-target"

/** The form field that carries the shared files: `share_target.params.files[0].name` in the manifest. */
export const shareFileField = "file"

/** In the app's address after a share. Its value says whether the files got onto the phone. */
export const sharedParam = "shared"

/** Where the service worker sends the browser after a share. The app opens with the phone's copy of the files. */
export const afterSharePath = `/?${sharedParam}=1`

/** The value of `sharedParam` after a share whose files did not get onto the phone. */
export const lostShare = "lost"

/** Where the server sends the browser when a share reached it. The app says "Bitte nochmal teilen". */
export const afterLostSharePath = `/?${sharedParam}=${lostShare}`
