'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Megaphone } from '@phosphor-icons/react'
import { usePathname, useRouter } from 'next/navigation'
import { useI18n } from '../hooks/useI18n'
import { useUserUiPreferences } from '../hooks/useUserUiPreferences'
import { useAuthStore } from '../store/auth'
import {
  type ProductUpdate,
  unseenProductUpdates,
  updatesForRole,
} from '../productUpdates'
import type { PanelLanguage } from '../types'

const COPY = {
  en: {
    label: 'What’s new',
    unseen: (count: number) => `What’s new: ${count} unseen ${count === 1 ? 'update' : 'updates'}`,
    dialog: 'What’s new in Docmee',
    latest: 'LATEST UPDATE',
    dismiss: 'Dismiss',
    viewAll: 'View all updates',
  },
  es: {
    label: 'Novedades',
    unseen: (count: number) => `Novedades: ${count} ${count === 1 ? 'actualizacion nueva' : 'actualizaciones nuevas'}`,
    dialog: 'Novedades de Docmee',
    latest: 'ULTIMA NOVEDAD',
    dismiss: 'Cerrar',
    viewAll: 'Ver todas las novedades',
  },
} as const

interface ProductUpdatesButtonProps {
  unseenCount: number
  expanded: boolean
  language: PanelLanguage
  onToggle: () => void
}

export function ProductUpdatesButton({ unseenCount, expanded, language, onToggle }: ProductUpdatesButtonProps) {
  const copy = COPY[language]
  const label = unseenCount > 0 ? copy.unseen(unseenCount) : copy.label

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      aria-haspopup="dialog"
      onClick={onToggle}
      className="crm-topbar-action-btn crm-topbar-action-btn--accent"
    >
      <Megaphone aria-hidden="true" size={14} weight={unseenCount > 0 ? 'fill' : 'regular'} />
      {unseenCount > 0 && (
        <span className="crm-topbar-action-badge flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan-500 px-1 text-[10px] font-bold text-slate-950">
          {unseenCount > 99 ? '99+' : unseenCount}
        </span>
      )}
    </button>
  )
}

interface ProductUpdatePopoverProps {
  update: ProductUpdate
  language: PanelLanguage
  onDismiss: () => void
  onViewAll: () => void
}

export function ProductUpdatePopover({ update, language, onDismiss, onViewAll }: ProductUpdatePopoverProps) {
  const copy = COPY[language]
  const published = new Intl.DateTimeFormat(language === 'es' ? 'es' : 'en', {
    dateStyle: 'medium',
  }).format(new Date(update.publishedAt))

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-label={copy.dialog}
      className="absolute right-0 top-full z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] border border-slate-600 bg-slate-900 p-4 text-left text-slate-100 shadow-2xl"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.14em] text-cyan-300">{copy.latest}</p>
          <h2 className="mt-1 text-base font-semibold">{update.title[language]}</h2>
        </div>
        <time dateTime={update.publishedAt} className="shrink-0 text-xs text-slate-400">{published}</time>
      </div>
      <p className="mt-2 text-sm leading-5 text-slate-300">{update.summary[language]}</p>
      <ul className="mt-3 space-y-2 text-sm text-slate-200">
        {update.highlights.map((highlight) => (
          <li key={highlight.en} className="flex gap-2">
            <span aria-hidden className="text-cyan-400">•</span>
            <span>{highlight[language]}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex justify-end gap-2 border-t border-slate-700 pt-3">
        <button type="button" onClick={onDismiss} className="border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800">
          {copy.dismiss}
        </button>
        <button type="button" onClick={onViewAll} className="bg-cyan-500 px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
          {copy.viewAll}
        </button>
      </div>
    </section>
  )
}

// The clinic and Studio layouts each mount their own control, so a layout switch
// (e.g. Studio → /updates) remounts it. Track auto-open and acknowledgement per
// page load, not per mount, or the popup reopens over the page the user just
// asked to see.
let autoOpenedThisPageLoad = false
let acknowledgedThisPageLoad: string | null = null

export function ProductUpdatesControl() {
  const router = useRouter()
  const pathname = usePathname()
  const { language } = useI18n()
  const role = useAuthStore((state) => state.user?.role)
  const { preferences, isLoading, setPreferences } = useUserUiPreferences()
  const [open, setOpen] = useState(false)
  const releases = useMemo(() => updatesForRole(role), [role])
  const lastSeen = acknowledgedThisPageLoad ?? preferences.lastSeenProductUpdateId
  const unseen = useMemo(() => unseenProductUpdates(releases, lastSeen), [releases, lastSeen])
  const latest = releases[0]
  const onUpdatesPage = pathname === '/updates' || pathname?.startsWith('/updates/') === true

  useEffect(() => {
    if (!isLoading && unseen.length > 0 && !autoOpenedThisPageLoad && !onUpdatesPage) {
      autoOpenedThisPageLoad = true
      setOpen(true)
    }
  }, [isLoading, unseen.length, onUpdatesPage])

  const acknowledgeLatest = useCallback(() => {
    if (!latest) return
    acknowledgedThisPageLoad = latest.id
    if (preferences.lastSeenProductUpdateId === latest.id) return
    setPreferences({ lastSeenProductUpdateId: latest.id })
  }, [latest, preferences.lastSeenProductUpdateId, setPreferences])

  const dismiss = useCallback(() => {
    setOpen(false)
    acknowledgeLatest()
  }, [acknowledgeLatest])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dismiss, open])

  if (!latest) return null

  return (
    <div className="relative">
      <ProductUpdatesButton
        unseenCount={unseen.length}
        expanded={open}
        language={language}
        onToggle={() => (open ? dismiss() : setOpen(true))}
      />
      {open && (
        <>
          <button
            type="button"
            aria-label={language === 'es' ? 'Cerrar novedades' : 'Close product updates'}
            className="fixed inset-0 z-40 cursor-default"
            onClick={dismiss}
          />
          <ProductUpdatePopover
            update={latest}
            language={language}
            onDismiss={dismiss}
            onViewAll={() => {
              acknowledgeLatest()
              setOpen(false)
              router.push('/updates')
            }}
          />
        </>
      )}
    </div>
  )
}
