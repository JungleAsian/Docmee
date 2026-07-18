#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = fileURLToPath(new URL('..', import.meta.url))
const srcRoot = join(appRoot, 'src')
const i18nPath = join(srcRoot, 'shared', 'i18n.ts')
const i18nSource = readFileSync(i18nPath, 'utf8')

function extractObjectBody(source, marker) {
  const start = source.indexOf(marker)
  if (start === -1) throw new Error(`Could not find ${marker}`)
  const open = source.indexOf('{', start)
  if (open === -1) throw new Error(`Could not find object for ${marker}`)
  let depth = 0
  let quote = null
  let escaped = false
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i]
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === quote) {
        quote = null
      }
      continue
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '{') depth += 1
    if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  throw new Error(`Could not close object for ${marker}`)
}

function extractDictKeys(marker) {
  const body = extractObjectBody(i18nSource, marker)
  const keys = new Set()
  const keyPattern = /^\s*['"]([^'"]+)['"]\s*:/gm
  for (const match of body.matchAll(keyPattern)) keys.add(match[1])
  return keys
}

function listSourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listSourceFiles(full))
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

const es = extractDictKeys('const es: Dict =')
const en = extractDictKeys('const en: Dict =')
const failures = []

for (const key of es) {
  if (!en.has(key)) failures.push(`Missing EN translation for ${key}`)
}
for (const key of en) {
  if (!es.has(key)) failures.push(`Missing ES translation for ${key}`)
}

const directKeyPatterns = [
  /\bt\(\s*['"]([^'"]+)['"]/g,
  /\btranslate\(\s*[^,]+,\s*['"]([^'"]+)['"]/g,
]

for (const file of listSourceFiles(srcRoot)) {
  if (file === i18nPath) continue
  const text = readFileSync(file, 'utf8')
  for (const pattern of directKeyPatterns) {
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) {
      const key = match[1]
      if (!es.has(key) || !en.has(key)) {
        failures.push(`${relative(appRoot, file)} uses missing key ${key}`)
      }
    }
  }
}

if (failures.length > 0) {
  console.error('i18n key check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`i18n key check passed: ${es.size} ES keys, ${en.size} EN keys, direct usages verified.`)
