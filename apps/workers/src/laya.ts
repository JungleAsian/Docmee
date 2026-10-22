import { createServerLayaAdapter } from '@docmee/agents'
import { createLayaControlsRepository, createServiceDbClient, type Sql } from '@docmee/db'

let initialized = false
let adapter: ReturnType<typeof createServerLayaAdapter>
let controlsDb: Sql | undefined

export function getLayaAdapter(): ReturnType<typeof createServerLayaAdapter> {
  if (!initialized) {
    adapter = createServerLayaAdapter({
      endpoint: process.env['DOCMEE_LAYA_ENDPOINT'],
      readRows: clinicId => {
        // Job clients close after each workflow. Keep a separate lazy pool so one
        // process-wide adapter retains its inference budget across concurrent jobs.
        controlsDb ??= createServiceDbClient({ url: process.env['DATABASE_URL'] ?? '' })
        return createLayaControlsRepository(controlsDb).readForClinic(clinicId)
      },
      // No reviewed calibration is installed: even live flags cannot apply a choice.
    })
    initialized = true
  }
  return adapter
}

/** Called only after workers have drained their in-flight jobs. */
export async function closeLaya(): Promise<void> {
  const closing = controlsDb
  controlsDb = undefined
  if (closing) await closing.end({ timeout: 2 })
}
