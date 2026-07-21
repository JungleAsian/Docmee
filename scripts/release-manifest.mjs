#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const commit = git(['rev-parse', 'HEAD'])
const shortCommit = git(['rev-parse', '--short=12', 'HEAD'])
const dirty = git(['status', '--porcelain']).length > 0
const buildId = process.env.DOCMEE_BUILD_ID?.trim() || `git-${shortCommit}`
const manifest = {
  schemaVersion: 1,
  buildId,
  commit,
  generatedAt: new Date().toISOString(),
  dirty,
  requiredRuntime: { api: buildId, workers: buildId, inboxos: buildId },
}
writeFileSync(path.join(root, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(JSON.stringify(manifest))
if (dirty) {
  console.error('Refusing to certify a dirty checkout as a release artifact.')
  process.exitCode = 1
}
