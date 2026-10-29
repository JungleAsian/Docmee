import { createLayaAdapter, type LayaAdapterDependencies, type LayaControls } from './adapter.js'
import { createLayaControlsReader } from './controls.js'
import { createLayaHttpTransport } from './http.js'

export interface ServerLayaOptions {
  endpoint?: string
  readRows: (clinicId: string) => Promise<unknown>
  qualification?: LayaControls['qualification']
  record?: LayaAdapterDependencies['record']
  fetcher?: typeof fetch
  /** Caller deadline; must exceed the runtime's own inference deadline (2 s). */
  timeoutMs?: number
}

/** DOCMEE_LAYA_TIMEOUT_MS: whole milliseconds, 100–5000. Anything else keeps the adapter default (750). */
export function parseLayaTimeoutMs(raw: string | undefined): number | undefined {
  if (typeof raw !== 'string' || !/^\d{3,4}$/.test(raw.trim())) return undefined
  const value = Number(raw.trim())
  return value >= 100 && value <= 5000 ? value : undefined
}

/** One instance per server process: its concurrency budget is shared across clinics. */
export function createServerLayaAdapter(options: ServerLayaOptions): ReturnType<typeof createLayaAdapter> | undefined {
  if (!options.endpoint) return undefined
  let transport: LayaAdapterDependencies['transport']
  try { transport = createLayaHttpTransport({ endpoint: options.endpoint, fetcher: options.fetcher }) }
  catch { return undefined }
  return createLayaAdapter({
    readControls: createLayaControlsReader(options.readRows, options.qualification),
    transport,
    record: options.record,
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  })
}
