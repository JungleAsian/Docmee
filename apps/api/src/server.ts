import 'dotenv/config'
import { buildApp } from './app.js'

const PORT = Number(process.env['API_PORT']) || 3001
const HOST =
  process.env['API_HOST'] ||
  (process.env['NODE_ENV'] === 'production' ? '127.0.0.1' : '0.0.0.0')

const app = await buildApp()

try {
  await app.listen({ port: PORT, host: HOST })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

// CRE-55: drain in-flight requests on PM2 reload/deploy (SIGINT/SIGTERM) before exit.
let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  app.log.info({ signal }, 'shutting down — closing server')
  try {
    await app.close()
  } catch (err) {
    app.log.error(err)
  }
  process.exit(0)
}
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    void shutdown(sig)
  })
}
