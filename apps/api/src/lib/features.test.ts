import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  query: vi.fn(),
  fail: false,
}))

vi.mock('./db.js', () => ({
  withDb: async (callback: (sql: typeof h.query) => unknown) => {
    if (h.fail) throw new Error('database unavailable')
    return callback(h.query)
  },
}))

import { getDocmeeExpansionFeatures, isDocmeeExpansionFeatureEnabled } from './features.js'

describe('migration-backed Docmee expansion features', () => {
  beforeEach(() => {
    h.query.mockReset()
    h.fail = false
  })

  it('enables only durable global rollout rows', async () => {
    h.query.mockResolvedValue([
      { name: 'docmee_inbox_layout_v2', clinicId: null, enabled: true, rolloutPercentage: 100 },
      { name: 'docmee_media_repository', clinicId: null, enabled: true, rolloutPercentage: 100 },
      { name: 'unrelated_flag', clinicId: null, enabled: true, rolloutPercentage: 100 },
    ])

    await expect(getDocmeeExpansionFeatures()).resolves.toEqual({
      inboxLayoutV2: true,
      humanOnlyMode: false,
      classifications: false,
      calendarPolicyV2: false,
      mediaRepository: true,
      notificationChimes: false,
      workflowEdgesV2: false,
    })
    await expect(isDocmeeExpansionFeatureEnabled('mediaRepository')).resolves.toBe(true)
  })

  it('honors a clinic-specific disable over a global enable', async () => {
    h.query.mockResolvedValue([
      { name: 'docmee_media_repository', clinicId: 'clinic-1', enabled: false, rolloutPercentage: 100 },
      { name: 'docmee_media_repository', clinicId: null, enabled: true, rolloutPercentage: 100 },
    ])

    await expect(isDocmeeExpansionFeatureEnabled('mediaRepository', 'clinic-1')).resolves.toBe(false)
  })

  it('does not expose a partial rollout to anonymous clients and buckets clinics deterministically', async () => {
    h.query.mockResolvedValue([
      { name: 'docmee_media_repository', clinicId: null, enabled: true, rolloutPercentage: 50 },
    ])

    await expect(isDocmeeExpansionFeatureEnabled('mediaRepository')).resolves.toBe(false)
    const first = await isDocmeeExpansionFeatureEnabled('mediaRepository', 'clinic-1')
    const second = await isDocmeeExpansionFeatureEnabled('mediaRepository', 'clinic-1')
    expect(second).toBe(first)
  })

  it('fails closed when rollout state cannot be read', async () => {
    h.fail = true

    await expect(getDocmeeExpansionFeatures()).resolves.toEqual({
      inboxLayoutV2: false,
      humanOnlyMode: false,
      classifications: false,
      calendarPolicyV2: false,
      mediaRepository: false,
      notificationChimes: false,
      workflowEdgesV2: false,
    })
  })
})
