# An accepted Print Job is always answered as one

Once CUPS has accepted a job, submit answers with the Print Job, even when filling the job folder, writing `job.json` or deleting the draft fails; those failures are only logged. A 5xx at that point would offer "Erneut versuchen", and the job would print twice. Paper printed twice is worse than a job folder missing after a restart.
