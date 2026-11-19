# Print Buddy

Print Buddy is a small web app for printing PDFs and photos from Android phones on the household printer. It hands the print jobs to the CUPS add-on, so that add-on must be running with a working queue. The app's own text is German.

## Options

| Option | Default | Meaning |
|---|---|---|
| `printer_name` | none, required | Name of the CUPS queue. Print Buddy sends print jobs to `ipp://172.30.32.1:631/printers/<queue>`. 172.30.32.1 is the Home Assistant host on its internal network on every install. Without this option Print Buddy doesn't start. |
| `upload_limit_mb` | `50` | Largest file a phone may send, in MB, from 1 to 100. |

Restart Print Buddy after changing an option.

Turn on **Watchdog** on the Print Buddy page. Home Assistant then restarts Print Buddy when it stops answering. Without the toggle, nothing restarts it. The check doesn't ask CUPS, so a printer that is off or a stopped CUPS add-on doesn't restart Print Buddy.

## Network

Port `9217/tcp` is off by default. Phones reach Print Buddy through the Cloudflare tunnel, which needs no host port. The repository README describes that setup.

To open Print Buddy on the home network as well, enter `9217` as the host port under Network, then open `http://<home-assistant-address>:9217`. This path has no login, so everyone on the home network can print. Sharing files to Print Buddy and installing it as an app work only through the tunnel.

Through the tunnel, the Cloudflare login lasts a month. When it has run out, the app shows "Anmeldung abgelaufen" with the button "Neu anmelden". After the login, the app goes on where the person was.

## Job files

Each print job has its own folder under `/share/print-buddy/jobs/`, named by date and job id. Open it with File Browser or Samba when something went wrong. The folder holds these files:

- `upload-1.pdf`, or `upload-1.jpg`, `upload-2.png` and so on, which are the files as the phone sent them.
- `print.pdf`, the PDF that Print Buddy sent to CUPS.
- `job.json`, with the print options, the sheet count, the CUPS job number, the times, what was uploaded, and what CUPS last said about the job. The upload details are PDF or photos, the size, and the number of pages or photos. The file holds no names, no emails and no file names.

Print Buddy deletes a job folder 7 days after the job was sent, and deletes uploads that were never printed after 1 hour. It checks when it starts and every hour. It leaves other files under `/share/print-buddy/jobs/` alone. The `share` folder is not part of this add-on's backup.

A job prints even when Print Buddy can't write its folder. The Print Buddy log then says which folder is incomplete.

## Updates

Updates arrive as ready-made images, and Home Assistant builds nothing. If the first install fails with a pull error, the image on GitHub is still private. The release steps in the repository README fix that.

Report problems at https://github.com/Kuirak/print-buddy/issues. The screens where something can go wrong have the button "Bericht kopieren". It copies a short report without names or file names. Paste that report into the issue.
