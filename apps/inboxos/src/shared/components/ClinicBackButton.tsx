'use client'

// Clinic-section back-navigation control — the counterpart to PlatformBackButton
// (which is scoped to /studio/*). Rendered once in the clinic header so every
// clinic page (alerts, calendar, waitlist, reports, a patient detail, …) has a
// consistent way back, exactly like Admin Studio.
//
// History-aware: use the browser's previous page when it exists, then fall back
// to the current section's parent for direct links, refreshes, or new tabs.
import { usePathname, useRouter } from 'next/navigation'
import { ArrowLeft } from '@phosphor-icons/react'
import { useI18n } from '../hooks/useI18n'

const CLINIC_HOME = '/inbox'

export function ClinicBackButton() {
  const pathname = usePathname()
  const router = useRouter()
  const { t } = useI18n()

  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return null
  if (pathname === CLINIC_HOME) return null

  let parent: string
  let preferExplicitParent = false
  if (segments[0] === 'inbox') {
    // /inbox/:id/patient is opened from the active conversation. Send operators
    // back to the inbox with the same thread selected instead of trusting browser
    // history, which can point at a refresh, external page, or new-tab entry.
    parent = segments[1] && segments[2] === 'patient'
      ? `${CLINIC_HOME}?c=${encodeURIComponent(segments[1])}`
      : CLINIC_HOME
    preferExplicitParent = Boolean(segments[1] && segments[2] === 'patient')
  } else {
    const up = segments.slice(0, -1)
    parent = up.length ? '/' + up.join('/') : CLINIC_HOME
  }
  const goBack = () => {
    if (preferExplicitParent) {
      router.push(parent)
      return
    }
    if (window.history.length > 1) {
      router.back()
      return
    }
    router.push(parent)
  }

  return (
    <button type="button" onClick={goBack} aria-label={t('nav.back')} title={t('nav.back')} className="crm-icon-btn">
      <ArrowLeft size={20} />
    </button>
  )
}
