// Knowledge-base routes (P08). KB content lives in knowledge_documents; embedding
// is offloaded to the kb-embed queue so the request returns immediately.
//   GET    /clinics/:id/kb               (any authenticated user, own clinic)
//   POST   /clinics/:id/kb               (clinic_admin, ia_studio_admin)
//   DELETE /clinics/:id/kb/:entryId      (clinic_admin, ia_studio_admin)
//   POST   /clinics/:id/kb/approve-all  (clinic_admin, ia_studio_admin)
//   POST   /clinics/:id/kb/reembed       (clinic_admin, ia_studio_admin)
import type { FastifyPluginAsync } from 'fastify'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'
import { z } from 'zod'
import { createKnowledgeRepository, createDoctorsRepository } from '@docmee/db'
import { kbEmbedQueue } from '@docmee/queue'
import { withDb } from '../lib/db.js'
import { validate } from '../lib/validate.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import {
  createKbVaultDownloadUrl,
  kbGithubObjectKey,
  kbVaultBucketName,
  kbVaultEnabled,
  uploadKbVaultObject,
} from '../lib/kb-vault-storage.js'

const createSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  documentType: z.enum(['faq', 'policy', 'service_info', 'custom']).optional(),
  status: z.enum(['active', 'draft', 'archived']).optional(),
  // Per-doctor FAQ scope (Req 30); null/omitted = clinic-wide.
  doctorId: z.string().uuid().nullable().optional(),
})

// Edit an entry's content/status/scope (Screen 7 entry editor) — at least one field.
const patchSchema = z
  .object({
    title: z.string().min(1).optional(),
    content: z.string().min(1).optional(),
    documentType: z.enum(['faq', 'policy', 'service_info', 'custom']).optional(),
    status: z.enum(['active', 'draft', 'archived']).optional(),
    doctorId: z.string().uuid().nullable().optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: 'Provide at least one field to update',
  })

const execFileAsync = promisify(execFile)
const DEFAULT_MAX_KB_FILES = 200
const DEFAULT_MAX_KB_FILE_BYTES = 256 * 1024
const DEFAULT_MAX_KB_TOTAL_BYTES = 5 * 1024 * 1024

function envReady(name: string): boolean {
  return Boolean((process.env[name] ?? '').trim())
}

function parseCsvEnv(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function verifyGithubSignature(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature?.startsWith('sha256=')) return false
  const digest = createHmac('sha256', secret).update(rawBody).digest('hex')
  const expected = Buffer.from(`sha256=${digest}`)
  const actual = Buffer.from(signature)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function ipv4ToInt(ip: string): number | null {
  if (net.isIP(ip) !== 4) return null
  return ip.split('.').reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0)
}

function ipAllowed(ip: string, allowlist: string[]): boolean {
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true
  const normalized = ip.startsWith('::ffff:') ? ip.slice(7) : ip
  const value = ipv4ToInt(normalized)
  return allowlist.some((entry) => {
    if (entry === normalized || entry === ip) return true
    const [range, bitsRaw] = entry.split('/')
    if (!range || !bitsRaw) return false
    const base = ipv4ToInt(range)
    const bits = Number(bitsRaw)
    if (value === null || base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    return (value & mask) === (base & mask)
  })
}

function validateGithubPayload(body: unknown, expectedRepo: string, branch: string) {
  const payload = body as {
    ref?: string
    deleted?: boolean
    repository?: { full_name?: string; private?: boolean }
    pusher?: { name?: string }
    after?: string
  } | null
  const fullName = payload?.repository?.full_name
  const expectedRef = `refs/heads/${branch}`
  if (fullName !== expectedRepo) {
    return { ok: false as const, status: 403, error: 'Unexpected repository' }
  }
  if (payload?.repository?.private !== true) {
    return { ok: false as const, status: 403, error: 'Repository must be private' }
  }
  if (payload?.ref !== expectedRef) {
    return { ok: false as const, status: 202, ignored: `non-target ref ${payload?.ref ?? 'unknown'}` }
  }
  if (payload?.deleted === true) {
    return { ok: false as const, status: 202, ignored: 'deleted ref' }
  }
  return { ok: true as const }
}

function validateKbContent(relativePath: string, content: string, size: number): string[] {
  const issues: string[] = []
  const maxFileBytes = Number(process.env['DOCMEE_KB_MAX_FILE_BYTES'] ?? DEFAULT_MAX_KB_FILE_BYTES)
  if (size > maxFileBytes) issues.push(`${relativePath}: file exceeds ${maxFileBytes} bytes`)
  const checks: Array<[RegExp, string]> = [
    [/-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/i, 'private key material'],
    [/\b(?:ghp|github_pat|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/, 'GitHub token'],
    [/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{20,}\b/, 'payment/API secret token'],
    [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
    [/\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"]?[A-Za-z0-9_./+=-]{16,}/i, 'credential-like assignment'],
    [/\b\d{3}-\d{2}-\d{4}\b/, 'SSN-like pattern'],
    [/\b(?:patient|dob|date of birth|medical record|mrn)\s*[:=]/i, 'PHI-like label'],
  ]
  for (const [pattern, label] of checks) {
    if (pattern.test(content)) issues.push(`${relativePath}: ${label}`)
  }
  return issues
}

async function walkKbFiles(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile() && /\.(md|markdown|txt)$/i.test(entry.name)) {
        out.push(full)
      }
    }
  }
  await walk(root)
  return out.sort()
}

function titleFromContent(relativePath: string, content: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim()
  if (heading) return heading.slice(0, 180)
  return relativePath.replace(/\\/g, '/').replace(/\.(md|markdown|txt)$/i, '').slice(0, 180)
}

function chunkText(content: string): string[] {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []
  const paragraphs = normalized.split(/\n{2,}/)
  const chunks: string[] = []
  let current = ''
  for (const paragraph of paragraphs) {
    const p = paragraph.trim()
    if (!p) continue
    if ((current + '\n\n' + p).trim().length > 1800 && current) {
      chunks.push(current)
      current = p
    } else {
      current = (current ? `${current}\n\n${p}` : p)
    }
  }
  if (current) chunks.push(current)
  return chunks.length > 0 ? chunks : [normalized.slice(0, 1800)]
}

async function syncGithubKb(app: Parameters<FastifyPluginAsync>[0]) {
  const repo = (process.env['DOCMEE_KB_GIT_REPO'] ?? '').trim()
  const workdir = (process.env['DOCMEE_KB_WORKDIR'] ?? '/var/lib/docmee/kb').trim()
  const keyPath = (process.env['DOCMEE_KB_DEPLOY_KEY_PATH'] ?? path.join(workdir, '.ssh/docmee_kb_deploy_key')).trim()
  const branch = (process.env['DOCMEE_KB_BRANCH'] ?? 'main').trim()
  const repoDir = (process.env['DOCMEE_KB_REPO_DIR'] ?? path.join(workdir, 'repo')).trim()
  const knownHosts = path.join(workdir, '.ssh/known_hosts')
  if (!repo) throw new Error('DOCMEE_KB_GIT_REPO is not configured')

  await fs.mkdir(path.dirname(repoDir), { recursive: true })
  const sshParts = ['ssh', '-i', keyPath, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes']
  try {
    await fs.access(knownHosts)
    sshParts.push('-o', `UserKnownHostsFile=${knownHosts}`, '-o', 'StrictHostKeyChecking=yes')
  } catch {
    sshParts.push('-o', 'StrictHostKeyChecking=accept-new')
  }
  const gitEnv = { ...process.env, GIT_SSH_COMMAND: sshParts.join(' ') }

  const gitDir = path.join(repoDir, '.git')
  try {
    await fs.access(gitDir)
    await execFileAsync('git', ['fetch', '--prune', 'origin', branch], { cwd: repoDir, env: gitEnv })
    await execFileAsync('git', ['reset', '--hard', `origin/${branch}`], { cwd: repoDir, env: gitEnv })
  } catch {
    await fs.rm(repoDir, { recursive: true, force: true })
    await execFileAsync('git', ['clone', '--depth', '1', '--branch', branch, repo, repoDir], { env: gitEnv })
  }

  const { stdout: commitStdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, env: gitEnv })
  const commit = commitStdout.trim()
  const files = await walkKbFiles(repoDir)
  const maxFiles = Number(process.env['DOCMEE_KB_MAX_FILES'] ?? DEFAULT_MAX_KB_FILES)
  if (files.length > maxFiles) throw new Error(`KB file count ${files.length} exceeds limit ${maxFiles}`)

  let totalBytes = 0
  const contentIssues: string[] = []
  for (const file of files) {
    const stat = await fs.stat(file)
    totalBytes += stat.size
    const relativePath = path.relative(repoDir, file).replace(/\\/g, '/')
    const content = await fs.readFile(file, 'utf8')
    contentIssues.push(...validateKbContent(relativePath, content, stat.size))
  }
  const maxTotalBytes = Number(process.env['DOCMEE_KB_MAX_TOTAL_BYTES'] ?? DEFAULT_MAX_KB_TOTAL_BYTES)
  if (totalBytes > maxTotalBytes) throw new Error(`KB total size ${totalBytes} exceeds limit ${maxTotalBytes}`)
  if (contentIssues.length > 0) throw new Error(`KB validation failed: ${contentIssues.slice(0, 10).join('; ')}`)

  const targetClinicIds = await withDb(async (sql) => {
    const configured = [
      ...parseCsvEnv('DOCMEE_KB_CLINIC_IDS'),
      ...parseCsvEnv('DOCMEE_KB_CLINIC_ID'),
    ]
    if (configured.length > 0) return [...new Set(configured)]
    const rows = await sql<{ id: string }[]>`SELECT id FROM clinics ORDER BY created_at`
    return rows.map((row) => row.id)
  })
  if (targetClinicIds.length === 0) throw new Error('No clinic targets found for KB sync')

  let documents = 0
  let chunks = 0
  await withDb(async (sql) => {
    for (const clinicId of targetClinicIds) {
      const existing = await sql<{ id: string }[]>`
        SELECT id FROM knowledge_documents
        WHERE clinic_id = ${clinicId} AND metadata ->> 'source' = 'github'
      `
      const existingIds = existing.map((row) => row.id)
      if (existingIds.length > 0) {
        await sql`DELETE FROM knowledge_chunks WHERE clinic_id = ${clinicId} AND document_id = ANY(${existingIds})`
        await sql`DELETE FROM knowledge_documents WHERE clinic_id = ${clinicId} AND id = ANY(${existingIds})`
      }

      const knowledge = createKnowledgeRepository(sql)
      for (const file of files) {
        const content = (await fs.readFile(file, 'utf8')).trim()
        if (!content) continue
        const relativePath = path.relative(repoDir, file).replace(/\\/g, '/')
        const vaultKey = kbGithubObjectKey({ clinicId, commit, relativePath })
        const vault = await uploadKbVaultObject({
          key: vaultKey,
          body: content,
          contentType: 'text/markdown; charset=utf-8',
          metadata: {
            clinicId,
            source: 'github',
            commit,
          },
        }).catch((err) => {
          app.log.warn({ err, clinicId, path: relativePath }, 'github kb vault upload skipped')
          return null
        })
        const document = await knowledge.createDocument({
          clinicId,
          title: titleFromContent(relativePath, content),
          content,
          documentType: 'custom',
          status: 'active',
          metadata: {
            source: 'github',
            repo,
            path: relativePath,
            commit,
            syncedAt: new Date().toISOString(),
            ...(vault
              ? {
                  vault: {
                    provider: 's3',
                    bucket: vault.bucket,
                    key: vault.key,
                    fileName: relativePath.split('/').pop() ?? relativePath,
                    contentType: 'text/markdown; charset=utf-8',
                    storedAt: new Date().toISOString(),
                  },
                }
              : {}),
          },
        })
        documents += 1
        const contentChunks = chunkText(content)
        for (let index = 0; index < contentChunks.length; index += 1) {
          const chunk = await knowledge.createChunk({
            clinicId,
            documentId: document.id,
            content: contentChunks[index]!,
            chunkIndex: index,
            metadata: { source: 'github', path: relativePath, commit },
          })
          chunks += 1
          await kbEmbedQueue.add('embed', { chunkId: chunk.id, clinicId, content: chunk.content })
        }
      }
    }
  })

  app.log.info({ repo, branch, commit, files: files.length, clinics: targetClinicIds.length, documents, chunks }, 'github kb sync complete')
  return { repo, branch, commit, files: files.length, clinics: targetClinicIds.length, documents, chunks }
}

const kbRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preParsing', async (request, _reply, payload) => {
    if (request.method !== 'POST' || request.url.split('?')[0] !== '/kb/github/webhook') return payload
    const chunks: Buffer[] = []
    for await (const chunk of payload) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    const rawBody = Buffer.concat(chunks)
    ;(request as typeof request & { rawBody?: Buffer }).rawBody = rawBody
    const replay = Readable.from(rawBody)
    ;(replay as typeof replay & { receivedEncodedLength?: number }).receivedEncodedLength = rawBody.length
    return replay
  })

  app.post('/kb/github/webhook', async (request, reply) => {
    const secret = (process.env['DOCMEE_KB_WEBHOOK_SECRET'] ?? '').trim()
    if (!secret) return reply.code(503).send({ error: 'KB webhook secret is not configured' })
    const allowedIps = parseCsvEnv('DOCMEE_KB_GITHUB_ALLOWED_IPS')
    if (allowedIps.length > 0 && !ipAllowed(request.ip, allowedIps)) {
      request.log.warn({ ip: request.ip }, 'github kb webhook rejected by ip allowlist')
      return reply.code(403).send({ error: 'Forbidden source' })
    }
    const rawBody = (request as typeof request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(request.body ?? {}))
    const signature = request.headers['x-hub-signature-256']
    if (!verifyGithubSignature(rawBody, Array.isArray(signature) ? signature[0] : signature, secret)) {
      return reply.code(401).send({ error: 'Invalid signature' })
    }

    const event = request.headers['x-github-event']
    if (event === 'ping') return { ok: true, event: 'ping' }
    if (event !== 'push') return reply.code(202).send({ ok: true, ignored: event ?? 'unknown' })

    const expectedRepo = (process.env['DOCMEE_KB_GITHUB_REPOSITORY'] ?? 'Patrick-and-Co/Docmee_KB').trim()
    const branch = (process.env['DOCMEE_KB_BRANCH'] ?? 'main').trim()
    const validation = validateGithubPayload(request.body, expectedRepo, branch)
    if (!validation.ok) {
      if ('ignored' in validation) return reply.code(validation.status).send({ ok: true, ignored: validation.ignored })
      return reply.code(validation.status).send({ error: validation.error })
    }

    try {
      const result = await syncGithubKb(app)
      return reply.code(202).send({ ok: true, synced: result })
    } catch (err) {
      request.log.error({ err }, 'github kb webhook sync failed')
      return reply.code(500).send({ error: 'KB sync failed' })
    }
  })

  app.addHook('preHandler', async (request, reply) => {
    if (request.method === 'POST' && request.url.split('?')[0] === '/kb/github/webhook') return
    return requireAuth(request, reply)
  })

  app.get<{ Params: { id: string } }>('/clinics/:id/kb', async (request, reply) => {
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    // Attach each document's training progress (chunk + embedded-chunk counts) so the
    // panel can show "trained / training / not indexed" without a per-document query.
    const documents = await withDb(async (sql) => {
      const repo = createKnowledgeRepository(sql)
      const [docs, stats] = await Promise.all([
        repo.listDocuments(clinicId),
        repo.documentTrainingStats(clinicId),
      ])
      const byDoc = new Map(stats.map((s) => [s.documentId, s]))
      return docs.map((d) => {
        const s = byDoc.get(d.id)
        return { ...d, chunkCount: s?.chunkCount ?? 0, embeddedCount: s?.embeddedCount ?? 0 }
      })
    })
    return { documents }
  })

  app.post<{ Params: { id: string } }>(
    '/clinics/:id/kb',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(createSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const { doctorId } = parsed.data
      const result = await withDb(async (sql) => {
        // A doctor-scoped FAQ (Req 30) must reference a doctor of THIS clinic.
        if (doctorId && !(await createDoctorsRepository(sql).findById(clinicId, doctorId))) {
          return { error: 'doctor_not_found' as const }
        }
        return {
          document: await createKnowledgeRepository(sql).createDocument({
            clinicId,
            title: parsed.data.title,
            content: parsed.data.content,
            documentType: parsed.data.documentType ?? 'faq',
            status: parsed.data.status ?? 'active',
            doctorId: doctorId ?? null,
          }),
        }
      })
      if ('error' in result) return reply.code(404).send({ error: 'Doctor not found' })
      // New content needs embedding before it can be retrieved.
      await kbEmbedQueue.add('embed-document', { clinicId, documentId: result.document.id })
      return reply.code(201).send({ document: result.document })
    },
  )

  app.patch<{ Params: { id: string; entryId: string } }>(
    '/clinics/:id/kb/:entryId',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(patchSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const { title, content, documentType, status, doctorId } = parsed.data
      const result = await withDb(async (sql) => {
        const repo = createKnowledgeRepository(sql)
        let document = await repo.findDocument(clinicId, request.params.entryId)
        if (!document) return { error: 'not_found' as const }
        // A doctor-scoped FAQ (Req 30) must reference a doctor of THIS clinic.
        if (doctorId && !(await createDoctorsRepository(sql).findById(clinicId, doctorId))) {
          return { error: 'doctor_not_found' as const }
        }
        if (title !== undefined || content !== undefined || documentType !== undefined) {
          document = await repo.updateDocument(clinicId, request.params.entryId, {
            title,
            content,
            documentType,
          })
        }
        if (status !== undefined) {
          document = await repo.updateDocumentStatus(clinicId, request.params.entryId, status)
        }
        if (doctorId !== undefined) {
          document = await repo.setDocumentDoctor(clinicId, request.params.entryId, doctorId)
        }
        return { document }
      })
      if ('error' in result) {
        return reply
          .code(404)
          .send({ error: result.error === 'doctor_not_found' ? 'Doctor not found' : 'Document not found' })
      }
      return { document: result.document }
    },
  )

  app.delete<{ Params: { id: string; entryId: string } }>(
    '/clinics/:id/kb/:entryId',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      await withDb(async (sql) =>
        createKnowledgeRepository(sql).deleteDocument(clinicId, request.params.entryId),
      )
      return { deleted: true }
    },
  )

  app.get<{ Params: { id: string; entryId: string } }>(
    '/clinics/:id/kb/:entryId/source-url',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const document = await withDb((sql) =>
        createKnowledgeRepository(sql).findDocument(clinicId, request.params.entryId),
      )
      if (!document) return reply.code(404).send({ error: 'Document not found' })
      const metadata = document.metadata as Record<string, unknown>
      const vault = metadata['vault'] as { key?: unknown; fileName?: unknown } | undefined
      const key = typeof vault?.key === 'string' ? vault.key : ''
      if (!key) return reply.code(404).send({ error: 'No source file stored for this KB item' })
      const url = await createKbVaultDownloadUrl(
        key,
        typeof vault?.fileName === 'string' ? vault.fileName : document.title,
      )
      if (!url) return reply.code(503).send({ error: 'KB vault storage is not configured' })
      return { url, expiresInSeconds: 300 }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/clinics/:id/kb/approve-all',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const documents = await withDb(async (sql) =>
        createKnowledgeRepository(sql).approveDraftDocuments(clinicId),
      )
      return { approved: documents.length, documents }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/clinics/:id/kb/reembed',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      await kbEmbedQueue.add('reembed-clinic', { clinicId })
      return reply.code(202).send({ queued: true })
    },
  )

  app.get<{ Params: { id: string } }>(
    '/clinics/:id/kb/architecture',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

      const stats = await withDb(async (sql) => {
        const repo = createKnowledgeRepository(sql)
        const [docs, training] = await Promise.all([
          repo.listDocuments(clinicId),
          repo.documentTrainingStats(clinicId),
        ])
        const activeDocs = docs.filter((doc) => doc.status === 'active')
        const trainedDocs = training.filter((row) => row.chunkCount > 0 && row.embeddedCount >= row.chunkCount)
        return {
          documents: docs.length,
          activeDocuments: activeDocs.length,
          trainedDocuments: trainedDocs.length,
          chunks: training.reduce((sum, row) => sum + row.chunkCount, 0),
          embeddedChunks: training.reduce((sum, row) => sum + row.embeddedCount, 0),
        }
      })

      const githubRepoConfigured = envReady('DOCMEE_KB_GIT_REPO')
      const deployKeyConfigured = envReady('DOCMEE_KB_DEPLOY_KEY_PATH') || envReady('DOCMEE_KB_DEPLOY_KEY')
      const workdirConfigured = envReady('DOCMEE_KB_WORKDIR')
      const webhookConfigured = envReady('DOCMEE_KB_WEBHOOK_SECRET')
      const s3VaultConfigured = kbVaultEnabled()

      return {
        architecture: 'obsidian-github-aws-postgres-pgvector',
        canonicalSource: 'private_github',
        sourceAuthoring: 'obsidian',
        productionReadsDirectlyFromGithub: false,
        phase: 'phase_1',
        configured: {
          githubRepo: githubRepoConfigured,
          deployKey: deployKeyConfigured,
          awsWorkdir: workdirConfigured,
          webhookSecret: webhookConfigured,
          s3Vault: s3VaultConfigured,
          s3VaultBucket: kbVaultBucketName() !== null,
          database: true,
          embeddings: stats.embeddedChunks > 0,
        },
        stats,
        missing: [
          githubRepoConfigured ? '' : 'DOCMEE_KB_GIT_REPO',
          deployKeyConfigured ? '' : 'DOCMEE_KB_DEPLOY_KEY_PATH or DOCMEE_KB_DEPLOY_KEY',
          workdirConfigured ? '' : 'DOCMEE_KB_WORKDIR',
          webhookConfigured ? '' : 'DOCMEE_KB_WEBHOOK_SECRET',
          s3VaultConfigured ? '' : 'S3_BUCKET_KB or DOCMEE_KB_S3_BUCKET',
        ].filter(Boolean),
      }
    },
  )
}

export default kbRoute
