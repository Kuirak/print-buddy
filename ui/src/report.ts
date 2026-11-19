// The report builder: the plain text behind "Bericht kopieren", for whoever fixes things.
// It is built from the stored job record and the live state (both read from the server) and from the
// browser. It never holds a file name or anything from a file: of the phone's files it reads only
// `type` and `size`, and the server keeps no file name at all.
import type { JobStatus, JobSubmitted, ReportFacts } from "../../shared/api.ts"
import type { PrintOptions } from "../../shared/print-options.ts"
import { ApiFailure, readJob, readReportFacts } from "./api.ts"
import { stateWords } from "./state-words.ts"

/** What a report is about: a Print Job, or what happened when there is none (a Refusal, a failed send). */
export type ReportSubject =
  | { job: JobSubmitted }
  | {
    /** One German sentence. */
    happened: string
    /** The files the person wanted to print. Called when the report is made. */
    files: () => File[] | Promise<File[]>
    options?: PrintOptions
  }

export type ReportInput = {
  /** When the report is made, in ms since the epoch. */
  now: number
  userAgent: string
  /** The server's part; undefined when the server didn't answer. */
  facts: ReportFacts | undefined
  about:
    /** `status` is undefined when the server couldn't be asked about the job. */
    | { job: JobSubmitted; status: JobStatus | undefined }
    | { happened: string; files: File[]; options?: PrintOptions }
}

const serverSilent = "unbekannt (Server nicht erreichbar)"
const time = (ms: number) => new Date(ms).toISOString()
const list = (values: string[]) => values.join(", ") || "–"

function jobLines(job: JobSubmitted, status: JobStatus | undefined): string[] {
  if (!status) return ["Zustand: unbekannt (der Auftrag konnte nicht gelesen werden)", `CUPS-Auftrag Nr.: ${job.cupsJobId}`]
  const { details } = status
  return [
    `Zustand: ${stateWords[status.state]}`,
    ...(status.reason === null ? [] : [`Grund: ${status.reason}`]),
    `Gesendet: ${time(status.sentAt)}`,
    ...(status.endedAt === null
      ? ["Beendet: noch nicht"]
      : [`Beendet: ${time(status.endedAt)}`, `Dauer: ${Math.round((status.endedAt - status.sentAt) / 1000)} s`]),
    `CUPS-Auftrag Nr.: ${status.cupsJobId}`,
    `CUPS-Zustand: ${details.jobState}`,
    `CUPS-Gründe: ${list(details.jobStateReasons)}`,
    `Drucker-Gründe beim Auftrag: ${list(details.printerStateReasons)}`,
    `Drucker-Meldung beim Auftrag: ${details.printerMessage || "–"}`,
    `Blätter: ${status.sheets}`,
  ]
}

function printerLines(facts: ReportFacts | undefined): string[] {
  if (!facts) return [`Drucker jetzt: ${serverSilent}`]
  const { state, reasons, message } = facts.printer
  return [`Drucker jetzt: ${state}`, `Drucker-Gründe: ${list(reasons)}`, `Drucker-Meldung: ${message || "–"}`]
}

function optionLines(options: PrintOptions): string[] {
  return [
    "Druckoptionen:",
    ...Object.entries(options).map(([name, value]) => `  ${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`),
  ]
}

function browserLine(userAgent: string) {
  const chrome = /Chrome\/(\S+)/.exec(userAgent)
  return chrome ? `Chrome: ${chrome[1]}` : `Browser: ${userAgent}`
}

/** The report as plain text. Sections are separated by an empty line. */
export function buildReport({ now, userAgent, facts, about }: ReportInput): string {
  const sections: string[][] = [["Print Buddy Bericht", `Erstellt: ${time(now)}`]]
  if ("job" in about) {
    sections.push(jobLines(about.job, about.status), printerLines(facts))
    if (about.status) {
      const { file, options } = about.status
      sections.push(
        [
          `Dateityp: ${file.kind === "pdf" ? "PDF" : "Foto"}`,
          `Größe: ${file.bytes} Bytes`,
          `${file.kind === "pdf" ? "Seiten" : "Fotos"}: ${file.count}`,
        ],
        optionLines(options),
      )
    }
  } else {
    const { files } = about
    sections.push([`Was passiert ist: ${about.happened}`], printerLines(facts), [
      `Dateityp: ${[...new Set(files.map(file => file.type || "unbekannt"))].join(", ") || "–"}`,
      `Größe: ${files.reduce((sum, file) => sum + file.size, 0)} Bytes`,
      `Dateien: ${files.length}`,
    ])
    if (about.options) sections.push(optionLines(about.options))
  }
  sections.push([`Print Buddy: ${facts?.version ?? serverSilent}`, browserLine(userAgent)])
  return sections.map(lines => lines.join("\n")).join("\n\n")
}

/** Says in German why a Print Job could not be sent, from what `print()` caught. */
export function sendFailure(error: unknown): string {
  const sentence = "Der Druckauftrag konnte nicht gesendet werden"
  if (!(error instanceof ApiFailure)) return `${sentence}: Der Server war nicht erreichbar.`
  const body = error.body
  const code = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? ` (${body.error})` : ""
  return `${sentence}: Der Server antwortete mit ${error.status}${code}.`
}

/**
 * Builds the report and puts it on the clipboard. A server that doesn't answer doesn't stop it: the
 * report then says so. Rejects only when the clipboard can't be written.
 */
export async function copyReport(subject: ReportSubject): Promise<void> {
  const [facts, about] = await Promise.all([
    readReportFacts().catch(() => undefined),
    "job" in subject
      ? readJob(subject.job.jobId).then(status => ({ job: subject.job, status }), () => ({ job: subject.job, status: undefined }))
      : Promise.resolve(subject.files()).then(files => ({ happened: subject.happened, files, options: subject.options })),
  ])
  await navigator.clipboard.writeText(buildReport({ now: Date.now(), userAgent: navigator.userAgent, facts, about }))
}
