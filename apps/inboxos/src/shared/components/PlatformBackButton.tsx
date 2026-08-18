'use client'

// Single, persistent back-navigation control shown once in the admin header
// (crm-top-header), next to the sidebar-rail toggle and Breadcrumbs -- NOT a
// per-page control (that pattern, one <BackButton> inlined into ~20 separate
// page headers, was replaced by this one global instance).
//
// Platform-level, not browser-level: the destination is derived purely from
// the CURRENT URL's own hierarchy (strip the last path segment), never from
// browser history (router.back()/history.back()). A history-based "back"
// is unpredictable -- it depends on how the admin arrived at the page
// (direct link, refresh, opened in a new tab, browser back/forward), and can
// send them somewhere outside the app entirely. Stripping the last URL
// segment is 100% deterministic regardless of navigation history.
//
// Scoped to /studio/* (matches Breadcrumbs' own scope) and hidden at the
// Studio root itself, since there's no parent to go to from there.
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowLeft } from '@phosphor-icons/react'
import { useI18n } from '../hooks/useI18n'

export function PlatformBackButton() {
  const pathname = usePathname()
  const { t } = useI18n()

  const segments = pathname.split('/').filter(Boolean)
  const studioIdx = segments.indexOf('studio')
  if (studioIdx === -1) return null
  if (segments.length <= studioIdx + 1) return null // already at /studio root

  const parentPath = '/' + segments.slice(0, segments.length - 1).join('/')

  return (
    <Link href={parentPath} aria-label={t('nav.back')} title={t('nav.back')} className="crm-icon-btn">
      <ArrowLeft size={20} />
    </Link>
  )
}
