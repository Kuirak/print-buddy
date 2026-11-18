# Print Buddy

Print Buddy is a small web app for printing PDFs and photos from Android phones on the household printer. It hands the jobs to the CUPS add-on, so that add-on must be running with a working queue. The app's own text is German.

## Options

| Option | Default | Meaning |
|---|---|---|
| `printer_uri` | `ipp://172.30.32.1:631/printers/Printer` | IPP address of the CUPS queue. Use the IP address: CUPS rejects requests that name it by an internal hostname. |
| `upload_limit_mb` | `50` | Largest file a phone may send, in MB (1 to 100). |

Restart Print Buddy after changing an option.

Turn on **Watchdog** on the Print Buddy page. Home Assistant then restarts Print Buddy when it stops answering. Without the toggle nothing is restarted.

## Network

Port `9217/tcp` is off by default. Phones reach Print Buddy through the Cloudflare tunnel, which needs no host port. The repository README describes that setup.

To open Print Buddy inside the home network as well, enter `9217` as the host port under Network, then open `http://<home-assistant-address>:9217`. There is no login on this path: everyone on the home network can print. Sharing files to Print Buddy and installing it as an app work only through the tunnel.

## Job files

Each print job has its own folder under `/share/print-buddy/jobs/`. Print Buddy deletes old ones itself. The `share` folder is not part of this add-on's backup.

## Updates

Updates arrive as ready-made images; Home Assistant builds nothing. If the first install fails with a pull error, the image on GitHub is still private; see the release steps in the repository README.

Problems: https://github.com/Kuirak/print-buddy/issues
