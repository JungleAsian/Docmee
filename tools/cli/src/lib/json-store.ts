import fs from 'node:fs'
import path from 'node:path'
import { logsDir } from './paths.js'

export function readJson<T>(name: string, fallback: T): T {
  const file = path.join(logsDir, name)
  if (!fs.existsSync(file)) return fallback
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T
}

export function writeJson<T>(name: string, data: T) {
  fs.mkdirSync(logsDir, { recursive: true })
  fs.writeFileSync(path.join(logsDir, name), `${JSON.stringify(data, null, 2)}\n`)
}
