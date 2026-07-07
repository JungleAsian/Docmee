import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const toolsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
export const logsDir = path.join(toolsRoot, 'logs')
export const payloadsDir = path.join(toolsRoot, 'payloads')
export const templatesDir = path.join(toolsRoot, 'templates')
export const promptsDir = path.join(toolsRoot, 'prompts')
export const deployDir = path.join(toolsRoot, 'deploy')
export const envFile = path.join(toolsRoot, '.env.tools')
export const envExampleFile = path.join(toolsRoot, '.env.tools.example')
