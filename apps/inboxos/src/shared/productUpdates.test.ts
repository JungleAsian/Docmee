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
  it('announces LAYA diagnostics in both catalogs only to superusers, with test limitations', () => {
    const update = updatesForRole('ia_studio_admin')[0]
    const feature = featuresForRole('ia_studio_admin').find((item) => item.id === 'laya-diagnostics')
    expect(update.id).toBe('2026-10-22-laya-diagnostics')
    expect(feature?.href).toBe('/studio/ai-settings')
    for (const language of ['en', 'es'] as const) {
      expect(update.title[language]).toContain('LAYA')
      expect(update.summary[language].length).toBeGreaterThan(0)
      expect(update.highlights.every((item) => item[language].length > 0)).toBe(true)
      expect(feature?.title[language]).toContain('LAYA')
      expect(feature?.description[language].length).toBeGreaterThan(0)
    }
    expect(update.highlights.map((item) => item.en).join(' ')).toContain('does not enable clinic routing')
    expect(update.highlights.map((item) => item.es).join(' ')).toContain('no habilita el enrutamiento clínico')
    for (const role of [undefined, 'clinic_admin', 'secretary']) {
      expect(updatesForRole(role).some((item) => item.id === update.id)).toBe(false)
      expect(featuresForRole(role).some((item) => item.id === 'laya-diagnostics')).toBe(false)
    }
  })
  it('lists Scheduled Messages in updates and All Features with rollout limits in both languages', () => {
    const update = updatesForRole('secretary').find((item) => item.id === '2026-10-07-scheduled-messages')
    const feature = featuresForRole('secretary').find((item) => item.id === 'scheduled-messages')
    expect(update?.summary.en).toContain('disabled by default')
    expect(update?.summary.es).toContain('desactivada por defecto')
    expect(feature?.description.en).toContain('Disabled by default')
    expect(feature?.description.es).toContain('Desactivado por defecto')
    expect(feature?.href).toBe('/inbox')
  })
  it('keeps workflow authoring announcements and tools exclusive to superusers', () => {
    expect(updatesForRole('ia_studio_admin').some((item) => item.id === '2026-10-08-workflow-jzel')).toBe(true)
    expect(featuresForRole('ia_studio_admin').find((item) => item.id === 'workflow-jzel')?.href).toBe('/studio/workflows')
    for (const role of ['clinic_admin', 'secretary']) {
      expect(updatesForRole(role).some((item) => item.id === '2026-10-08-workflow-jzel')).toBe(false)
      expect(featuresForRole(role).some((item) => item.id === 'workflow-jzel')).toBe(false)
    }
  })
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
