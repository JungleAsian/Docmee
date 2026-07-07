import fs from 'node:fs'
import path from 'node:path'
import { logsDir } from './paths.js'

export type LogLevel = 'info' | 'warn' | 'error'

export function log(command: string, message: string, level: LogLevel = 'info') {
  const today = new Date().toISOString().split('T')[0]
  const logFile = path.join(logsDir, `${command}-${today}.log`)
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}\n`
  fs.mkdirSync(logsDir, { recursive: true })
  fs.appendFileSync(logFile, line)
  const prefix = level === 'error' ? '[error]' : level === 'warn' ? '[warn]' : '[info]'
  console.log(`${prefix} ${message}`)
}
