import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3'
import {
  createMediaAssetsRepository,
  createServiceDbClient,
  type MediaAssetsRepository,
  type Sql,
} from '@docmee/db'

export const MEDIA_CLEANUP_INTERVAL_MS = 5 * 60 * 1000

export interface MediaCleanupStorage {
  region: string
  bucket: string
  prefix: string
}

interface DeleteObjectInput extends MediaCleanupStorage {
  key: string
}

type CleanupRepository = Pick<
  MediaAssetsRepository,
  'claimDueCleanup' | 'markDeletionComplete' | 'markDeletionFailed'
>

type CleanupResult = { claimed: number; completed: number; failed: number }

export interface RunMediaCleanupOptions {
  repository?: CleanupRepository
  storage?: MediaCleanupStorage | null
  deleteObject?: (input: DeleteObjectInput) => Promise<void>
  claimLimit?: number
}

export function mediaCleanupStorageFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): MediaCleanupStorage | null {
  const region =
    env['S3_BUCKET_KB_REGION']?.trim() ||
    env['DOCMEE_KB_S3_REGION']?.trim() ||
    env['AWS_REGION']?.trim() ||
    env['AWS_DEFAULT_REGION']?.trim() ||
    ''
  const bucket =
    env['S3_BUCKET_KB']?.trim() ||
    env['DOCMEE_KB_S3_BUCKET']?.trim() ||
    env['S3_BUCKET_VOICE_NOTES']?.trim() ||
    ''
  if (region === '' || bucket === '') return null
  const prefix = (env['DOCMEE_KB_S3_PREFIX']?.trim() || 'voice-notes').replace(/^\/+|\/+$/g, '')
  if (prefix === '') return null
  return { region, bucket, prefix }
}

const clients = new Map<string, S3Client>()

async function deleteS3Object(input: DeleteObjectInput): Promise<void> {
  const key = input.key.trim().replace(/^\/+/, '')
  if (key === '' || !key.startsWith(`${input.prefix}/`)) {
    throw new Error('media_cleanup_unsafe_storage_key')
  }
  const clientKey = `${input.region}:${input.bucket}`
  let client = clients.get(clientKey)
  if (!client) {
    client = new S3Client({ region: input.region })
    clients.set(clientKey, client)
  }
  await client.send(new DeleteObjectCommand({ Bucket: input.bucket, Key: key }))
}

export async function runMediaCleanup(
  sql: Sql,
  options: RunMediaCleanupOptions = {},
): Promise<CleanupResult> {
  const storage = options.storage === undefined ? mediaCleanupStorageFromEnv() : options.storage
  if (!storage) return { claimed: 0, completed: 0, failed: 0 }

  const repository = options.repository ?? createMediaAssetsRepository(sql)
  const deleteObject = options.deleteObject ?? deleteS3Object
  const assets = await repository.claimDueCleanup(options.claimLimit)
  let completed = 0
  let failed = 0

  for (const asset of assets) {
    try {
      await deleteObject({ ...storage, key: asset.storageKey })
    } catch {
      await repository.markDeletionFailed(asset.clinicId, asset.id, 's3_delete_failed')
      failed += 1
      continue
    }
    await repository.markDeletionComplete(asset.clinicId, asset.id)
    completed += 1
  }

  return { claimed: assets.length, completed, failed }
}

export interface MediaCleanupSchedulerOptions {
  createSql?: () => Sql
  run?: (sql: Sql) => Promise<CleanupResult>
}

export function startMediaCleanupScheduler(
  options: MediaCleanupSchedulerOptions = {},
): ReturnType<typeof setInterval> {
  const createSql = options.createSql ?? (() => createServiceDbClient({ url: process.env['DATABASE_URL'] ?? '' }))
  const run = options.run ?? ((sql: Sql) => runMediaCleanup(sql))
  const scheduler = setInterval(() => {
    const sql = createSql()
    void run(sql)
      .catch((error) => console.error('[media-cleanup] tick failed:', error))
      .finally(() => { void sql.end() })
  }, MEDIA_CLEANUP_INTERVAL_MS)
  if (typeof scheduler.unref === 'function') scheduler.unref()
  return scheduler
}
