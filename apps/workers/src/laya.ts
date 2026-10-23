import { createServerLayaAdapter, parseLayaQualification } from '@docmee/agents'
import { createLayaControlsRepository, createServiceDbClient, type Sql } from '@docmee/db'

let initialized = false
let adapter: ReturnType<typeof createServerLayaAdapter>
let layaDb: Sql | undefined
const background = new Set<Promise<unknown>>()

/** Process-wide pool for LAYA controls and watch-only observations. Job clients close after
 * each workflow, so background observation writes must not borrow them. */
export function getLayaDb(): Sql {
  layaDb ??= createServiceDbClient({ url: process.env['DATABASE_URL'] ?? '' })
  return layaDb
}

export function getLayaAdapter(): ReturnType<typeof createServerLayaAdapter> {
  if (!initialized) {
    adapter = createServerLayaAdapter({
      endpoint: process.env['DOCMEE_LAYA_ENDPOINT'],
      readRows: clinicId => createLayaControlsRepository(getLayaDb()).readForClinic(clinicId),
      // Server-owned record. Unset/malformed = unconfigured (every response rejected);
      // reviewed:false = watch-only; only a reviewed record with thresholds can apply.
      qualification: parseLayaQualification(process.env['DOCMEE_LAYA_QUALIFICATION']),
    })
    initialized = true
  }
  return adapter
}

/** Watch-only work that must never delay or fail a patient reply. */
export function runLayaBackground(task: () => Promise<unknown>): void {
  const work = Promise.resolve().then(task).catch(() => undefined)
  background.add(work)
  void work.finally(() => background.delete(work))
}

/** Called only after workers have drained their in-flight jobs. */
export async function closeLaya(): Promise<void> {
  if (background.size) {
    await Promise.race([Promise.allSettled([...background]), new Promise(resolve => setTimeout(resolve, 3000))])
  }
  const closing = layaDb
  layaDb = undefined
  if (closing) await closing.end({ timeout: 2 })
}
