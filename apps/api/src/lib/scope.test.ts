import { describe, it, expect } from 'vitest'
import type { FastifyRequest } from 'fastify'
import { resolveClinicScope } from './scope.js'
import type { JwtPayload } from '../auth/jwt.js'

// resolveClinicScope only reads request.user + request.headers, so a structural
// stub is enough — no Fastify instance required.
function req(user: JwtPayload | undefined, headers: Record<string, string> = {}): FastifyRequest {
  return { user, headers } as unknown as FastifyRequest
}

// Clinic ids are uuids in production (resolveClinicScope now validates the format),
// so the fixtures use real uuids rather than 'c-1' shorthands.
const C1 = '11111111-1111-4111-8111-111111111111'
const C2 = '22222222-2222-4222-8222-222222222222'
const C3 = '33333333-3333-4333-8333-333333333333'
const C9 = '99999999-9999-4999-8999-999999999999'

const secretary: JwtPayload = { userId: 'u-1', clinicId: C1, role: 'secretary', email: 's@demo.test' }
const admin: JwtPayload = { userId: 'a-1', clinicId: C1, role: 'ia_studio_admin', email: 'a@demo.test' }

describe('resolveClinicScope', () => {
  it('unauthenticated → null', () => {
    expect(resolveClinicScope(req(undefined))).toBeNull()
  })

  it('non-admin with no hint → own clinic', () => {
    expect(resolveClinicScope(req(secretary))).toBe(C1)
  })

  it('non-admin requesting own clinic → own clinic', () => {
    expect(resolveClinicScope(req(secretary), C1)).toBe(C1)
  })

  it('non-admin requesting a foreign clinic → null (forbidden)', () => {
    expect(resolveClinicScope(req(secretary), C2)).toBeNull()
  })

  it('non-admin with a foreign X-Clinic-Id header → null (no privilege escalation)', () => {
    expect(resolveClinicScope(req(secretary, { 'x-clinic-id': C2 }))).toBeNull()
  })

  it('non-admin with own-clinic header → own clinic', () => {
    expect(resolveClinicScope(req(secretary, { 'x-clinic-id': C1 }))).toBe(C1)
  })

  it('admin with no hint → own clinic', () => {
    expect(resolveClinicScope(req(admin))).toBe(C1)
  })

  it('admin may target any clinic via the active-clinic header', () => {
    expect(resolveClinicScope(req(admin, { 'x-clinic-id': C9 }))).toBe(C9)
  })

  it('an explicit route param wins over the header', () => {
    expect(resolveClinicScope(req(admin, { 'x-clinic-id': C9 }), C3)).toBe(C3)
  })

  it('an empty header is ignored (falls back to own clinic)', () => {
    expect(resolveClinicScope(req(admin, { 'x-clinic-id': '' }))).toBe(C1)
  })

  it('a malformed clinic id → null (even for an admin, so it never reaches a uuid query)', () => {
    expect(resolveClinicScope(req(admin), 'not-a-uuid')).toBeNull()
    expect(resolveClinicScope(req(secretary), 'not-a-uuid')).toBeNull()
  })
})
