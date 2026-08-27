import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MediaAsset, MediaAssetsRepository, Sql } from '@docmee/db'
import { runMediaCleanup, startMediaCleanupScheduler } from '../media-cleanup.js'

const asset: MediaAsset = {
  id: 'asset-1',
  clinicId: 'clinic-1',
  uploadedBy: 'staff-1',
  filename: 'scan.png',
  contentType: 'image/png',
  byteSize: 42,
  checksum: 'checksum',
  storageKey: 'voice-notes/clinic-1/media/asset-1/scan.png',
  storageStatus: 'delete_pending',
  storageFailureCode: null,
  storageCleanupAttempts: 2,
  storageCleanupRetryAt: null,
  deletedAt: null,
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:10:00.000Z',
}

function cleanupRepository(claimed: MediaAsset[] = [asset]) {
  const state = {
    claims: 0,
    completed: [] as string[],
    failed: [] as Array<{ id: string; code: string }>,
  }
  const repository = {
    async claimDueCleanup() {
      state.claims += 1
      return claimed
    },
    async markDeletionComplete(_clinicId: string, id: string) {
      state.completed.push(id)
    },
    async markDeletionFailed(_clinicId: string, id: string, code: string) {
      state.failed.push({ id, code })
    },
  } as Pick<MediaAssetsRepository, 'claimDueCleanup' | 'markDeletionComplete' | 'markDeletionFailed'>
  return { repository, state }
}

const sql = {} as Sql
const storage = { region: 'us-east-1', bucket: 'private-media', prefix: 'voice-notes' }

afterEach(() => {
  vi.useRealTimers()
})

describe('media cleanup consumer', () => {
  it('does not claim database work when S3 storage is not configured', async () => {
    const { repository, state } = cleanupRepository()

    const result = await runMediaCleanup(sql, { repository, storage: null })

    expect(result).toEqual({ claimed: 0, completed: 0, failed: 0 })
    expect(state.claims).toBe(0)
  })

  it('marks a claimed asset deleted only after its S3 object is removed', async () => {
    const { repository, state } = cleanupRepository()
    const deletedKeys: string[] = []

    const result = await runMediaCleanup(sql, {
      repository,
      storage,
      deleteObject: async ({ key }) => { deletedKeys.push(key) },
    })

    expect(result).toEqual({ claimed: 1, completed: 1, failed: 0 })
    expect(deletedKeys).toEqual(['voice-notes/clinic-1/media/asset-1/scan.png'])
    expect(state.completed).toEqual(['asset-1'])
    expect(state.failed).toEqual([])
  })

  it('records a retryable failure when S3 deletion fails', async () => {
    const { repository, state } = cleanupRepository()

    const result = await runMediaCleanup(sql, {
      repository,
      storage,
      deleteObject: async () => { throw new Error('network unavailable') },
    })

    expect(result).toEqual({ claimed: 1, completed: 0, failed: 1 })
    expect(state.completed).toEqual([])
    expect(state.failed).toEqual([{ id: 'asset-1', code: 's3_delete_failed' }])
  })

  it('runs every five minutes and closes each tick database client', async () => {
    vi.useFakeTimers()
    const ticks: string[] = []
    const closes: string[] = []
    const scheduler = startMediaCleanupScheduler({
      createSql: () => ({ end: async () => { closes.push('closed') } }) as Sql,
      run: async () => { ticks.push('tick'); return { claimed: 0, completed: 0, failed: 0 } },
    })

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

    expect(ticks).toEqual(['tick'])
    expect(closes).toEqual(['closed'])
    clearInterval(scheduler)
  })
})
