// The share target's address and names, for the service worker, the app and the server.
// `ui/public/manifest.webmanifest` declares the first two to Android; a test keeps them equal.

/** Where Android POSTs a share: `share_target.action` in the manifest. */
export const shareTargetPath = "/share-target"

/** The form field that carries the shared files: `share_target.params.files[0].name` in the manifest. */
export const shareFileField = "file"

/** In the app's address after a share. It tells the app to open with the phone's copy of the files. */
export const sharedParam = "shared"

/** Where the browser is sent after a share. */
export const afterSharePath = `/?${sharedParam}=1`
