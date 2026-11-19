import { loadConfig } from "./config.ts"
import { startServer } from "./server.ts"
import { version } from "./version.ts"

let config
try {
  config = await loadConfig(process.env)
} catch (err) {
  console.error(`Print Buddy can't start: ${(err as Error).message}`)
  process.exit(1)
}
const server = await startServer(config)
console.log(`Print Buddy ${version} listening on port ${new URL(server.url).port}, printing to ${config.printerUri}`)

// In the add-on node is PID 1 (`init: false`): without a handler it would ignore the Supervisor's SIGTERM.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    server.close().then(() => process.exit(0), err => {
      console.error(err)
      process.exit(1)
    })
  })
}
