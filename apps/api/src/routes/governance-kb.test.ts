import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { signAccessToken } from '../auth/jwt.js'

const mocks = vi.hoisted(() => ({ update: vi.fn(), log: vi.fn() }))
vi.mock('../lib/db.js', () => ({ withDb: (fn: (sql: unknown) => unknown) => fn({}) }))
vi.mock('@docmee/db', () => ({
  createKnowledgeRepository: () => ({ updateDocumentGovernance: mocks.update }),
  createAuditRepository: () => ({ log: mocks.log }),
  createAppointmentsRepository: vi.fn(), createDoctorsRepository: vi.fn(), toJson: (v: unknown) => v,
}))
import route from './governance.js'

async function patch(clinicId = 'clinic-a', role: 'secretary' | 'clinic_admin' = 'clinic_admin') {
  const app = Fastify(); await app.register(route)
  try {
    return await app.inject({ method: 'PATCH', url: `/clinics/${clinicId}/kb/doc/governance`,
      headers: { authorization: `Bearer ${signAccessToken({ userId: 'admin', email: 'admin@example.test', clinicId: 'clinic-a', role })}` },
      payload: { reviewState: 'excluded', notes: 'Needs review' },
    })
  } finally { await app.close() }
}

describe('KB governance writer boundary', () => {
  beforeEach(() => vi.clearAllMocks())
  it('uses the shared transactional repository writer and preserves the audit/response contract', async () => {
    mocks.update.mockResolvedValueOnce({ id: 'doc', status: 'archived' })
    const result = await patch()
    expect(result.statusCode).toBe(200)
    expect(result.json()).toEqual({ document: { id: 'doc', status: 'archived' } })
    expect(mocks.update).toHaveBeenCalledWith('clinic-a', 'doc', { governanceReviewState: 'excluded', governanceNotes: 'Needs review' })
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'knowledge.governance_updated', resourceId: 'doc', clinicId: 'clinic-a' }))
  })
  it('preserves missing-document and clinic/role boundaries', async () => {
    mocks.update.mockResolvedValueOnce(null)
    expect((await patch()).statusCode).toBe(404)
    expect((await patch('foreign')).statusCode).toBe(403)
    expect((await patch('clinic-a', 'secretary')).statusCode).toBe(403)
    expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(mocks.log).not.toHaveBeenCalled()
  })
})
