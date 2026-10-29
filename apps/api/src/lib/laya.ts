import { createServerLayaAdapter, parseLayaQualification, parseLayaTimeoutMs } from '@docmee/agents'
import { createLayaControlsRepository } from '@docmee/db'
import { withDb } from './db.js'

let initialized = false
let adapter: ReturnType<typeof createServerLayaAdapter>

export function getLayaAdapter(): ReturnType<typeof createServerLayaAdapter> {
  if (!initialized) {
    adapter = createServerLayaAdapter({
      endpoint: process.env['DOCMEE_LAYA_ENDPOINT'],
      readRows: clinicId => withDb(sql => createLayaControlsRepository(sql).readForClinic(clinicId)),
      // Server-owned record (see workers/src/laya.ts). Unset = unconfigured; reviewed:false = watch-only.
      qualification: parseLayaQualification(process.env['DOCMEE_LAYA_QUALIFICATION']),
      timeoutMs: parseLayaTimeoutMs(process.env['DOCMEE_LAYA_TIMEOUT_MS']),
    })
    initialized = true
  }
  return adapter
}
