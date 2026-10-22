import { createLayaAdapter, type LayaAdapterDependencies, type LayaControls } from './adapter.js'
import { createLayaControlsReader } from './controls.js'
import { createLayaHttpTransport } from './http.js'

export interface ServerLayaOptions {
  endpoint?: string
  readRows: (clinicId: string) => Promise<unknown>
  qualification?: LayaControls['qualification']
  record?: LayaAdapterDependencies['record']
  fetcher?: typeof fetch
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
  })
}
