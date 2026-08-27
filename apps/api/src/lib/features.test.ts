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
      { name: 'docmee_inbox_layout_v2' },
      { name: 'docmee_media_repository' },
      { name: 'unrelated_flag' },
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
