import fs from 'node:fs'
import path from 'node:path'

/** Read a JSON file by absolute path, returning a fallback on any failure. */
export function readJsonFile<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** Atomically write a JSON file (write temp + rename) to avoid partial reads. */
export function writeJsonFile(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`)
  fs.renameSync(tmp, file)
}

export function fileSize(file: string) {
  try {
    return fs.statSync(file).size
  } catch {
    return 0
  }
}

export function fileMtimeMs(file: string) {
  try {
    return fs.statSync(file).mtimeMs
  } catch {
    return null
  }
}
