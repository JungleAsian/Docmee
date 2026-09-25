import { describe, expect, it } from 'vitest'
import {
  featuresForRole,
  type ProductUpdate,
  unseenProductUpdates,
  updatesForRole,
} from './productUpdates'

const releases: ProductUpdate[] = [
  {
    id: 'newest',
    publishedAt: '2026-09-24T12:00:00.000Z',
    audience: 'all',
    title: { en: 'Newest', es: 'Mas reciente' },
    summary: { en: 'Newest summary', es: 'Resumen reciente' },
    highlights: [{ en: 'One', es: 'Uno' }],
  },
  {
    id: 'admin-only',
    publishedAt: '2026-09-23T12:00:00.000Z',
    audience: 'admin',
    title: { en: 'Admin', es: 'Admin' },
    summary: { en: 'Admin summary', es: 'Resumen admin' },
    highlights: [{ en: 'Two', es: 'Dos' }],
  },
  {
    id: 'oldest',
    publishedAt: '2026-09-22T12:00:00.000Z',
    audience: 'all',
    title: { en: 'Oldest', es: 'Mas antiguo' },
    summary: { en: 'Oldest summary', es: 'Resumen antiguo' },
    highlights: [{ en: 'Three', es: 'Tres' }],
  },
]

describe('product updates', () => {
  it('returns permitted releases newest first for each role', () => {
    expect(updatesForRole('secretary', releases).map((release) => release.id)).toEqual(['newest', 'oldest'])
    expect(updatesForRole('clinic_admin', releases).map((release) => release.id)).toEqual([
      'newest',
      'admin-only',
      'oldest',
    ])
  })

  it('filters the feature catalog for the current role', () => {
    expect(featuresForRole('secretary').some((feature) => feature.audience === 'admin')).toBe(false)
    expect(featuresForRole('clinic_admin').some((feature) => feature.audience === 'admin')).toBe(true)
  })

  it('treats every permitted release as unseen when there is no acknowledgement', () => {
    expect(unseenProductUpdates(releases, null).map((release) => release.id)).toEqual([
      'newest',
      'admin-only',
      'oldest',
    ])
  })

  it('returns only releases newer than the acknowledged release', () => {
    expect(unseenProductUpdates(releases, 'admin-only').map((release) => release.id)).toEqual(['newest'])
    expect(unseenProductUpdates(releases, 'newest')).toEqual([])
  })

  it('fails safe by treating an unknown acknowledgement as unseen', () => {
    expect(unseenProductUpdates(releases, 'missing').map((release) => release.id)).toEqual([
      'newest',
      'admin-only',
      'oldest',
    ])
  })
})
