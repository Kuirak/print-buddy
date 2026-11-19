# Nothing personal is kept

Print Buddy doesn't record who printed what, so that the family's printing stays private, and a report can be sent to whoever fixes things without exposing the document. It stores and logs no names of people, email addresses or file names. The job folder names its files `upload-1.pdf` and so on, `job.json` holds only the type, size and count of what was uploaded, and the report reads only the type and size of the phone's files. The server never reads the Cloudflare Access headers, `Cf-Access-*`, or the `CF_Authorization` cookie into anything that is stored, logged or sent to CUPS.

## Consequences

`server/report.test.ts` sends the Access headers with every request of a Print Job and checks that nothing of them reaches CUPS, the job folder, the answers or the log. A new field of `PrintJob` or a new line in the report must not come from a file name, file contents or an error message the browser made up.
