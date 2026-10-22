import { createServerLayaAdapter } from '@docmee/agents'
import { createLayaControlsRepository } from '@docmee/db'
import { withDb } from './db.js'

let initialized = false
let adapter: ReturnType<typeof createServerLayaAdapter>

export function getLayaAdapter(): ReturnType<typeof createServerLayaAdapter> {
  if (!initialized) {
    adapter = createServerLayaAdapter({
      endpoint: process.env['DOCMEE_LAYA_ENDPOINT'],
      readRows: clinicId => withDb(sql => createLayaControlsRepository(sql).readForClinic(clinicId)),
      // No reviewed calibration is installed: even live flags cannot apply a choice.
    })
    initialized = true
  }
  return adapter
}
