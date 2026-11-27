# Print Buddy

A small web app for printing PDFs and photos from the family's Android phones on the household Printer. It runs as a Home Assistant add-on next to the CUPS add-on. The vocabulary is in `GLOSSARY.md`.

This repository is also the Home Assistant add-on repository. `repository.yaml` is at the root, and the add-on is in `print-buddy/`. Home Assistant pulls a ready-made image for the Raspberry Pi 4, which is aarch64, and builds nothing.

## Install in Home Assistant

1. The CUPS add-on must be running, with a queue that prints a test page.
2. In Settings > Apps > Install app > ⋮ > Repositories, add `https://github.com/Kuirak/print-buddy`. Always enter it exactly like this. Home Assistant derives the add-on's internal hostname from the text of this URL.
3. Install **Print Buddy** from the store. Enter `printer_name`, the name of the CUPS queue. Home Assistant asks for it before the first start. Check `upload_limit_mb`, turn on **Watchdog** and **Start on boot**, then start the add-on. The Documentation tab shows `print-buddy/DOCS.md`, which explains the options, the optional LAN port and where the Print Job files are.

## Cloudflare setup

Do the steps in this order. The Access application comes first, so the hostname is never reachable without a login.

### 1. Access application

In Cloudflare Zero Trust, add a self-hosted Access application:

- Hostname `print.example.org`, no path.
- One Allow policy that lists the 2 family email addresses.
- Login by one-time PIN only, with instant authentication on.
- Session duration 1 month, for the application and for the global session.
- No Bypass policy, and leave the cookie's SameSite setting at its default.

### 2. Tunnel route with "Protect with Access"

The tunnel runs in token mode, so you set its routes in the dashboard. Add a published application route:

- Hostname `print.example.org`.
- Service `http://0086bcee-print-buddy:9217`. This is the add-on's hostname inside Home Assistant. It needs no host port, so leave the port under Network empty.
- Turn on **Protect with Access** and pick the application from step 1. cloudflared then drops every request that carries no valid Access login.

Home Assistant derives `0086bcee` from the repository URL as you entered it in step 2 of the install. For another URL, compute it with `printf %s "<url in lower case>" | shasum | cut -c1-8`, or read the hostname on the add-on's page.

To check, open `https://print.example.org` in a private window. It shows the Cloudflare login, and after the PIN it shows Print Buddy.

### 3. Install on the phones from Chrome

On each Android phone:

1. Open `https://print.example.org` in Chrome and log in with the PIN.
2. Chrome menu > "Zum Startbildschirm hinzufügen" > "Installieren".
3. Share a PDF from another app. "Print Buddy" must be in the share sheet.

Then go through the on-device checks below.

### On-device checks for the first build, by hand

No test covers the installed app on a phone. The install, the share sheet and the update all need a real Android Chrome. Do these checks once on each Android phone with the first build, through `https://print.example.org`. Do them again after a change to `ui/public/manifest.webmanifest`, `ui/src/sw.ts` or `ui/src/app-update.ts`.

- [ ] **Install.** Chrome offers "Installieren", not only a plain shortcut. The app opens in its own window without the address bar, with the icon of the smiling printer and the name "Print Buddy". The Start screen shows "Teile ein PDF oder Fotos aus einer anderen App mit Print Buddy." If Chrome offers no install, apply the Bypass fallback below.
- [ ] **Share a PDF.** In another app, for example Files, Gmail or Drive, share one PDF and pick Print Buddy in the share sheet. The options screen opens with the file's name, without a tap in between. Print it. The status screen follows the Print Job.
- [ ] **Share photos.** In the gallery, select three photos and share them to Print Buddy. The options screen opens with "3 Fotos". They print in the order they were selected, one per sheet.
- [ ] **Refused shares.** Share 21 photos, and the app shows "Höchstens 20 Fotos auf einmal". Share two PDFs, and it shows "Bitte jeweils nur eine Datei teilen". Share a PDF together with a photo, and it shows "Bitte PDF und Fotos getrennt teilen". All three screens offer "Datei auswählen", and nothing prints.
- [ ] **Print again from the phone's copy.** After "Fertig", tap "Nochmal drucken". A second Print Job prints without sharing again. Then tap "Schließen".
- [ ] **Update after a new version.** Install a newer add-on version in Home Assistant. Open Print Buddy on the phone and wait a few seconds on the Start screen. The app reloads once by itself into the new version. Check this with whatever the release changed on screen.
- [ ] **No update in the middle of a Print Job.** Install a newer add-on version, then share a PDF and stay on the options screen for half a minute. The screen must not reload. Print and tap "Schließen". Now the app reloads into the new version.
- [ ] **A share that arrives empty.** A share may open Print Buddy on "Bitte nochmal teilen" instead of the options screen. Then either that phone's Chrome delivers shares without their files, or the share went to the server because the app's service worker was not running yet. The first case is a known Chrome bug on Chrome 153 with Android 17. "Datei auswählen" still works. Share once more, and if it happens again, note the Chrome version.

These checks cover the behaviour after the session expires. The login lasts a month, so end it by hand before each of them. To end it, open `https://print.example.org/cdn-cgi/access/logout` in Chrome on the phone. If Print Buddy still gets through afterwards, revoke the person's session in Cloudflare Zero Trust instead and note that. Do these checks again after a change to `ui/src/interrupted-job.ts`, the login address in `shared/login.ts` or the Access application.

- [ ] **Expired login when the app opens.** End the login, then open Print Buddy. It shows "Anmeldung abgelaufen" with "Neu anmelden", and no broken screen. Tap "Neu anmelden", and the Cloudflare login appears. After the PIN, the app shows the Start screen.
- [ ] **Expired login with a share.** End the login, then share a PDF to Print Buddy. It shows "Anmeldung abgelaufen". Tap "Neu anmelden", fetch the PIN from the mail app and come back. After the PIN, the options screen opens with that PDF, without sharing it again.
- [ ] **Expired login at "Drucken".** Share a PDF and set 2 Kopien and Farbe. Then end the login in Chrome and go back to Print Buddy. Tap "Drucken". The app shows "Anmeldung abgelaufen", not "Drucken hat nicht geklappt". After the login, the options screen shows the same file with 2 Kopien and Farbe. Tap "Drucken", and it prints with those Print Options.
- [ ] **Expired login on the status screen.** Switch the Printer off and print a PDF, so the Print Job stays on "Wartet". End the login in Chrome and go back to Print Buddy. Within a few seconds the app shows "Anmeldung abgelaufen". After the login, the status screen shows the same "Auftrag Nr.", and "läuft seit" has gone on counting. Tap "Abbrechen".
- [ ] **Left on "Anmeldung abgelaufen".** Bring up "Anmeldung abgelaufen" at "Drucken" once more. Close the app instead of logging in, and open it again. After the login it shows the Start screen, and the Print Job is gone. The same happens if Android closes Print Buddy while the mail app is open for the PIN. If one of the checks above ended on the Start screen for that reason, note the phone. On that phone the person has to share again after a login.

Over plain HTTP on the Household network, the app can't be installed and has no share target. That address is `http://<home-assistant-address>:9217`, with the LAN port on. Check it once from a laptop. The Start screen has no share hint, only "Datei auswählen", and a picked PDF prints.

### 4. Bypass fallback

Use this only if step 3 fails, so Chrome offers no "Installieren" or Print Buddy is missing from the share sheet.

1. Add a second Access application for `print.example.org` with a Bypass policy for everyone, for exactly these paths: `/manifest.webmanifest`, `/sw.js`, `/icon-192.png`, `/icon-512.png` and `/icon-maskable-512.png`.
2. Add a tunnel route for the same paths to the same service, with "Protect with Access" off, and move it above the main route. Without this route, cloudflared still drops these requests.
3. Remove Print Buddy from the phone and repeat step 3.

Bypass nothing else. These files contain no personal data. `/login` and `/share-target` in particular stay behind the login. "Neu anmelden" loads `/login` so that Cloudflare shows its login there. If `/login` were bypassed, it would send the person straight back to "Anmeldung abgelaufen".

## Releasing

Versions have the form `YYYY.MM.N`, which is the year, the two-digit month, and a counter that starts at 0 each month. The one source is the `version` line in `print-buddy/config.yaml`. The server reads that file, and the release workflow refuses a tag that differs from it.

A change that people will notice adds a line under `## Unreleased` at the top of `print-buddy/CHANGELOG.md`, in the same commit. That change leaves the version alone, because only a release sets one.

1. Set the new version in `print-buddy/config.yaml` and rename `## Unreleased` in `print-buddy/CHANGELOG.md` to `## <version>`. `pnpm test` checks that the version equals the newest released entry.
2. Commit on a branch and tag that commit `v<version>`, for example `v2026.11.0`. Push the branch and the tag. `.github/workflows/release.yaml` builds the aarch64 image and pushes it to `ghcr.io/kuirak/print-buddy:<version>`.
3. Merge to `main` once the workflow is green. Home Assistant offers the update as soon as `main` holds the new version, so the image has to be there first.
4. Only after the very first release, open the package `print-buddy` on GitHub > Package settings > Change visibility > Public. GHCR creates it private, and Home Assistant pulls without a login.
5. Update the add-on in Home Assistant, then do the smoke print below.

Never push a different image under a version that already exists.

### Smoke print for every release, by hand

No test reaches the real Printer, so each release gets one print against the real queue:

1. Open Print Buddy on a phone through `https://print.example.org`.
2. Pick a one-page PDF, tap "Drucken" and confirm "Jetzt drucken?".
3. The app shows the job number, and the page comes out of the Printer.
4. The add-on log shows the new version. With the LAN port on, `http://<home-assistant-address>:9217/health` shows it too.

### Layout check for a release that changes the layout, by hand

Tests measure the layout in points, but only paper and a ruler show what the Printer's real margins and feed do to it. Once per release that changes `shared/layout.ts` or the renderer, print photos on A4 against the real queue:

1. Four photos twice each at `8×`. All eight come out whole, two by four.
2. Photos at `10×15` with "Platz sparen". Cut them out and measure: 100 × 150 mm, within 1 mm.
3. Photos at `Passbild` with "Schnittlinien". Cut along the lines and measure: 35 × 45 mm, within 1 mm, and no line cuts into a photo.
4. Count the Passbilder on the sheet: as many as the preview shows. With margins of 9 pt left and right and 12 pt top and bottom, A4 holds 28 to 32, depending on Lage and Abstand; the Printer's own margins may change that. If a row is cut off at the Printer's edge, the margins the Printer reports are wrong.

## Development

Development needs Node 26 and pnpm 12. Run `pnpm install` once. Then run `pnpm dev` for the app with hot reload against a fake printer on http://localhost:5173, and run `pnpm test`.

- `docs/development.md` has the commands, where the files are, the rules, and how to test.
- `docs/architecture.md` explains how each part works, by area.
- `docs/adr/` records the decisions that are hard to reverse, and why.
- `GLOSSARY.md` has the vocabulary.
