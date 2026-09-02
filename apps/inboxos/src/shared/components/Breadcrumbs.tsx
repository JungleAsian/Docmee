'use client'

// Admin Studio breadcrumbs. Derives a trail from the current /studio/* path using a
// label map; unknown segments (e.g. a clinic id) fall back to a generic label.
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useI18n } from '../hooks/useI18n'
import type { TranslationKey } from '../i18n'

const SEGMENT_LABELS: Record<string, TranslationKey> = {
  studio: 'studio.breadcrumb.root',
  clinics: 'nav.clinics',
  users: 'nav.users',
  doctors: 'nav.doctors',
  channels: 'studio.breadcrumb.channels',
  'quick-replies': 'nav.quickReplies',
  templates: 'nav.templates',
  kb: 'nav.kb',
  errors: 'nav.errors',
  usage: 'nav.usage',
  license: 'nav.license',
  compliance: 'nav.compliance',
}

export function Breadcrumbs() {
  const pathname = usePathname()
  const { t } = useI18n()

  const segments = pathname.split('/').filter(Boolean)
  const studioIdx = segments.indexOf('studio')
  if (studioIdx === -1) return null

  const crumbs = segments.slice(studioIdx).map((segment, i) => {
    const href = '/' + segments.slice(0, studioIdx + i + 1).join('/')
    const key = SEGMENT_LABELS[segment]
    const label = key ? t(key) : t('studio.clinics.detail')
    return { href, label }
  })

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 overflow-hidden text-xs text-gray-500">
      {crumbs.map((crumb, i) => {
        const last = i === crumbs.length - 1
        return (
          <span key={crumb.href} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && <span className="text-gray-300 dark:text-gray-600">/</span>}
            {last ? (
              <span className="crm-header-breadcrumb" aria-current="page">{crumb.label}</span>
            ) : (
              <Link prefetch={false} href={crumb.href} className="truncate hover:text-teal-600">
                {crumb.label}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}
