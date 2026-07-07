import fs from 'node:fs'

// Shared safe JSON file read with fallback, used by the server pages that read
// tools/logs/*.json. Replaces the per-page copies that had drifted apart.
export function readJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}
