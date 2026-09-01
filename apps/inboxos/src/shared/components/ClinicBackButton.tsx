'use client'

// Clinic-section back-navigation control — the counterpart to PlatformBackButton
// (which is scoped to /studio/*). Rendered once in the clinic header so every
// clinic page (alerts, calendar, waitlist, reports, a patient detail, …) has a
// consistent way back, exactly like Admin Studio.
//
// Platform-level, not browser-level: the destination is derived from the current
// URL, never router.back()/history — deterministic regardless of how the user
// arrived. The clinic home is /inbox: anything under /inbox/* goes back to the
// inbox, a nested page (e.g. /help/[category]) drops its last segment, and any
// other top-level clinic page returns to the inbox. Hidden on /inbox itself,
// since there's no parent to go to from the home.
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowLeft } from '@phosphor-icons/react'
import { useI18n } from '../hooks/useI18n'

const CLINIC_HOME = '/inbox'

export function ClinicBackButton() {
  const pathname = usePathname()
  const { t } = useI18n()

  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return null
  if (pathname === CLINIC_HOME) return null

  let parent: string
  if (segments[0] === 'inbox') {
    // /inbox/:id, /inbox/:id/patient, … → back to the inbox queue.
    parent = CLINIC_HOME
  } else {
    const up = segments.slice(0, -1)
    parent = up.length ? '/' + up.join('/') : CLINIC_HOME
  }

  return (
    <Link href={parent} prefetch={false} aria-label={t('nav.back')} title={t('nav.back')} className="crm-icon-btn">
      <ArrowLeft size={20} />
    </Link>
  )
}
