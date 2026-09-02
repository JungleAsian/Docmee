'use client'

// Single, persistent back-navigation control shown once in the admin header
// (crm-top-header), next to the sidebar-rail toggle and Breadcrumbs -- NOT a
// per-page control (that pattern, one <BackButton> inlined into ~20 separate
// page headers, was replaced by this one global instance).
//
// History-aware: use the browser's previous page when it exists, then fall back
// to the current URL's parent for direct links, refreshes, or new tabs.
//
// Scoped to /studio/* (matches Breadcrumbs' own scope) and hidden at the
// Studio root itself, since there's no parent to go to from there.
import { usePathname, useRouter } from 'next/navigation'
import { ArrowLeft } from '@phosphor-icons/react'
import { useI18n } from '../hooks/useI18n'

export function PlatformBackButton() {
  const pathname = usePathname()
  const router = useRouter()
  const { t } = useI18n()

  const segments = pathname.split('/').filter(Boolean)
  const studioIdx = segments.indexOf('studio')
  if (studioIdx === -1) return null
  if (segments.length <= studioIdx + 1) return null // already at /studio root

  const parentPath = '/' + segments.slice(0, segments.length - 1).join('/')
  const goBack = () => {
    if (window.history.length > 1) {
      router.back()
      return
    }
    router.push(parentPath)
  }

  return (
    <button type="button" onClick={goBack} aria-label={t('nav.back')} title={t('nav.back')} className="crm-icon-btn">
      <ArrowLeft size={20} />
    </button>
  )
}
