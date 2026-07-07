export interface HealthOptions {
  attempts?: number
  delayMs?: number
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Poll the API health endpoint until it returns 200 or we exhaust the retry
 * budget. PM2 needs a moment to boot the services, so we retry with a fixed
 * delay rather than failing on the first refused connection.
 */
export async function verifyHealth(baseUrl: string, options: HealthOptions = {}): Promise<boolean> {
  const attempts = options.attempts ?? 20
  const delayMs = options.delayMs ?? 1500
  const url = `${baseUrl.replace(/\/$/, '')}/health`
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(url)
      if (res.ok) return true
    } catch {
      // service not up yet — fall through to retry
    }
    if (attempt < attempts) await sleep(delayMs)
  }
  return false
}
