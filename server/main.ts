import { loadConfig } from "./config.ts"
import { startServer } from "./server.ts"

const config = await loadConfig(process.env)
const server = await startServer(config)
console.log(`Print Buddy listening on port ${new URL(server.url).port}, printing to ${config.printerUri}`)
