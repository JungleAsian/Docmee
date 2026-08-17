'use client'

// Admin Studio — Screen 13 · Compliance & language (Features 19, 21).
// Three stacked sections that match the approved screen-13 mockup:
//   1. Panel language (Req 21) — per-user ES/EN toggle (useI18n → POST /user/preferences),
//      distinct from the bot language.
//   2. Compliance status (Req 19/21) — the guarantees Docmee enforces automatically,
//      each an informational + deep-linked posture card.
//   3. Meta submission checklist — an operator self-tracker persisted per-clinic in
//      clinic.settings.complianceChecklist (GET/PATCH /clinics/:id via
//      useComplianceChecklist), so progress is shared across the operator's devices.
// Permission-denied is handled upstream by the admin layout
// (useAuthGuard(['ia_studio_admin', 'clinic_admin'])); the nav only links this page
// for superusers, but a clinic_admin who navigates here directly still loads it fine.
// Loading / error / empty / offline / success states are handled inline below.
import Link from 'next/link'
import { useState } from 'react'
import { useI18n } from '@/shared/hooks/useI18n'
import { useOnline } from '@/shared/hooks/useOnline'
import { BackButton } from '@/shared/components/BackButton'
import {
  useComplianceChecklist,
  type ComplianceState,
} from '@/shared/hooks/useComplianceChecklist'
import { LANGUAGES, type TranslationKey } from '@/shared/i18n'
import type { PanelLanguage } from '@/shared/types'

// Endonyms shown on the panel-language toggle. Language names are not translated —
// "Español"/"English" read the same in either panel language, matching the mockup.
const LANG_DISPLAY: Record<PanelLanguage, { flag: string; name: string }> = {
  es: { flag: '🇪🇸', name: 'Español' },
  en: { flag: '🇬🇧', name: 'English' },
}

type ItemStatus = 'pending' | 'in_review' | 'done'
type ResolvedStatus = ItemStatus | 'blocked'

// The Meta WhatsApp Business submission steps, in order. `dependsOn` marks a step
// that stays "Blocked" until its prerequisite is done (mirrors the mockup's
// "Production access" gated behind "Phone number assurance L2").
const ITEMS: { id: string; titleKey: TranslationKey; descKey: TranslationKey; dependsOn?: string }[] = [
  { id: 'bizverify', titleKey: 'compliance.meta.bizverify.t', descKey: 'compliance.meta.bizverify.d' },
  { id: 'displayname', titleKey: 'compliance.meta.displayname.t', descKey: 'compliance.meta.displayname.d' },
  { id: 'privacy', titleKey: 'compliance.meta.privacy.t', descKey: 'compliance.meta.privacy.d' },
  { id: 'optin', titleKey: 'compliance.meta.optin.t', descKey: 'compliance.meta.optin.d' },
  { id: 'templates', titleKey: 'compliance.meta.templates.t', descKey: 'compliance.meta.templates.d' },
  { id: 'assurance', titleKey: 'compliance.meta.assurance.t', descKey: 'compliance.meta.assurance.d' },
  {
    id: 'production',
    titleKey: 'compliance.meta.production.t',
    descKey: 'compliance.meta.production.d',
    dependsOn: 'assurance',
  },
]

export default function CompliancePage() {
  const { t, language } = useI18n()
  const online = useOnline()
  // Open by default — this is the whole point of the page; a collapsed-by-default
  // section behind an unlabeled icon button reads as "broken/empty" to an admin who
  // has no reason to expect content is hidden. The toggle stays available for anyone
  // who wants to collapse it after reading.
  const [showPosture, setShowPosture] = useState(true)
  const [showChecklist, setShowChecklist] = useState(true)
  // Server-backed checklist (per-clinic, GET/PATCH /clinics/:id). Optimistic writes
  // give the same instant feedback the old localStorage tracker had.
  const { state, save, isLoading, isError, isSaving, refetch } = useComplianceChecklist()

  function persist(next: ComplianceState) {
    save(next)
  }

  // A step is "blocked" while its prerequisite isn't done; otherwise its stored status
  // (defaulting to pending). Blocked is computed, never stored, so it clears the moment
  // the prerequisite completes.
  function statusOf(id: string): ResolvedStatus {
    const item = ITEMS.find((i) => i.id === id)
    if (item?.dependsOn && (state[item.dependsOn]?.status ?? 'pending') !== 'done') return 'blocked'
    return state[id]?.status ?? 'pending'
  }

  // Click cycles a step forward: pending → in review → done → pending. Each non-pending
  // transition stamps today's date so the "when" reflects real progress, not demo data.
  function advance(id: string) {
    if (statusOf(id) === 'blocked') return
    const current = state[id]?.status ?? 'pending'
    const next: ItemStatus = current === 'pending' ? 'in_review' : current === 'in_review' ? 'done' : 'pending'
    persist({
      ...state,
      [id]: { status: next, date: next === 'pending' ? undefined : new Date().toISOString() },
    })
  }

  function reset() {
    persist({})
  }

  const done = ITEMS.filter((i) => statusOf(i.id) === 'done').length
  const total = ITEMS.length
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  const allDone = total > 0 && done === total

  return (
    <div className="clinic-page clinic-page-md space-y-6">
      {/* Page head */}
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <BackButton href="/studio" label={t('nav.studio')} />
          <h1 className="text-xl font-bold tracking-tight">{t('compliance.pageTitle')}</h1>
          <p className="mt-1 max-w-xl text-sm text-gray-500 dark:text-gray-400">{t('compliance.pageSubtitle')}</p>
        </div>
        <span
          className={
            online
              ? 'inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
              : 'inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300'
          }
        >
          <span aria-hidden>●</span>
          {online ? t('compliance.allActive') : t('compliance.guaranteesOffline')}
        </span>
      </div>

      {/* Offline / disconnected banner */}
      {!online && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          <span aria-hidden>📡</span>
          <span>{t('compliance.offlineBanner')}</span>
        </div>
      )}

      {/* SECTION 1 · Panel language (Req 21) */}
      <Section num={1} title={t('compliance.section.language')} right={<ReqLabel>{t('compliance.req.r21')}</ReqLabel>}>
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div className="max-w-lg">
            <div className="text-sm font-semibold">{t('compliance.lang.label')}</div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('compliance.lang.note')}</p>
            <p className="mt-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              ✓ {t('compliance.lang.applied')}
            </p>
          </div>
          <PanelLanguageToggle />
        </div>
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3.5 py-2.5 text-xs text-teal-800 dark:border-teal-900 dark:bg-teal-950 dark:text-teal-200">
          <span aria-hidden>ℹ️</span>
          <span>{t('compliance.lang.distinct')}</span>
        </div>
      </Section>

      {/* SECTION 2 · Compliance status (Req 19/21) */}
      <Section
        num={2}
        title={t('compliance.section.posture')}
        right={
          <div className="flex items-center gap-2">
            <ReqLabel>{t('compliance.req.r1921')}</ReqLabel>
            <InfoButton
              expanded={showPosture}
              label={t('compliance.posture.toggle')}
              onClick={() => setShowPosture((v) => !v)}
            />
          </div>
        }
      >
        {showPosture && (
          <>
            <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">{t('compliance.posture.hint')}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <PostureCard
                icon="✋"
                titleKey="compliance.posture.consent.title"
                bodyKey="compliance.posture.consent.body"
                metricKey="compliance.posture.consent.metric"
                active
              />
              <PostureCard
                icon="🤚"
                titleKey="compliance.posture.stop.title"
                bodyKey="compliance.posture.stop.body"
                metricKey="compliance.posture.stop.metric"
                active
              />
              <PostureCard
                icon="🔑"
                iconTone="warn"
                titleKey="compliance.posture.token.title"
                bodyKey="compliance.posture.token.body"
                linkHref="/studio/channels"
                linkKey="compliance.posture.token.link"
                path="/studio/channels"
              />
              <PostureCard
                icon="📨"
                titleKey="compliance.posture.templates.title"
                bodyKey="compliance.posture.templates.body"
                linkHref="/studio/templates"
                linkKey="compliance.posture.templates.link"
                path="/studio/templates"
              />
            </div>
          </>
        )}
      </Section>

      {/* SECTION 3 · Meta submission checklist */}
      <Section
        num={3}
        title={t('compliance.section.checklist')}
        right={
          <div className="flex items-center gap-2">
            {showChecklist && (
              <>
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-md border border-gray-200 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                >
                  {t('compliance.reset')}
                </button>
                <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-semibold text-teal-700 dark:bg-teal-950 dark:text-teal-300">
                  {isSaving && <span aria-hidden>⟳</span>}
                  {isSaving ? t('compliance.saving') : t('compliance.savedPill')}
                </span>
              </>
            )}
            <InfoButton
              expanded={showChecklist}
              label={t('compliance.checklist.toggle')}
              onClick={() => setShowChecklist((v) => !v)}
            />
          </div>
        }
      >
        {showChecklist && (isLoading ? (
          <ChecklistSkeleton />
        ) : isError ? (
          <ErrorState onRetry={refetch} />
        ) : total === 0 ? (
          <EmptyState />
        ) : (
          <>
            {/* Progress */}
            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>
                  {t('compliance.checklist.progress', { done, total })}
                </span>
                <span>{pct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            {allDone && (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                <span aria-hidden>🎉</span>
                <span>{t('compliance.checklist.allDone')}</span>
              </div>
            )}

            <p className="mb-2 text-xs text-gray-400">{t('compliance.checklist.advanceHint')}</p>

            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {ITEMS.map((item) => {
                const status = statusOf(item.id)
                const stored = state[item.id]
                const depItem = item.dependsOn ? ITEMS.find((i) => i.id === item.dependsOn) : undefined
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => advance(item.id)}
                      disabled={status === 'blocked'}
                      className={`flex w-full items-start gap-3 py-3 text-left transition-colors ${
                        status === 'blocked'
                          ? 'cursor-not-allowed opacity-70'
                          : 'cursor-pointer hover:bg-gray-50/60 dark:hover:bg-gray-800/40'
                      }`}
                    >
                      <StatusBox status={status} />
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block text-sm font-semibold ${
                            status === 'done' ? 'text-gray-400 line-through dark:text-gray-500' : ''
                          }`}
                        >
                          {t(item.titleKey)}
                        </span>
                        <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                          {t(item.descKey)}
                        </span>
                        {status === 'blocked' && depItem && (
                          <span className="mt-1 block text-[11px] text-gray-400">
                            {t('compliance.checklist.blockedHint', { dep: t(depItem.titleKey) })}
                          </span>
                        )}
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <StatusPill status={status} label={statusLabel(t, status)} />
                        {stored?.date && status !== 'blocked' && (
                          <span className="text-[11px] text-gray-400">{formatDate(stored.date, language)}</span>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>

            {/* Published privacy policy */}
            <div className="clinic-card mt-5 flex items-center justify-between gap-3 bg-gray-50 px-4 py-3 dark:bg-gray-800/40">
              <div className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-50 text-base text-teal-700 dark:bg-teal-950 dark:text-teal-300">
                  📄
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{t('compliance.policy.title')}</div>
                  <div className="truncate text-xs text-gray-400">/privacy-policy.html</div>
                </div>
              </div>
              <a
                href="/privacy-policy.html"
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-white dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900"
              >
                {t('compliance.policy.view')}
              </a>
            </div>

            <p className="mt-3 text-xs text-gray-400">{t('compliance.savedLocally')}</p>
          </>
        ))}
      </Section>
    </div>
  )
}


function InfoButton({
  expanded,
  label,
  onClick,
}: {
  expanded: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      className="grid h-7 w-7 place-items-center rounded-full border border-gray-300 text-xs font-semibold text-gray-500 hover:border-teal-300 hover:text-teal-600 dark:border-gray-700 dark:text-gray-400"
    >
      {expanded ? '▾' : '▸'}
    </button>
  )
}

// ── Section card: numbered badge + title on the left, an optional right slot
//    (requirement label or status pill), and a padded body. ────────────────────
function Section({
  num,
  title,
  right,
  children,
}: {
  num: number
  title: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="clinic-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
        <div className="flex items-center gap-3">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-teal-50 text-xs font-bold text-teal-700 dark:bg-teal-950 dark:text-teal-300">
            {num}
          </span>
          <h2 className="text-sm font-semibold">{title}</h2>
        </div>
        {right}
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

function ReqLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-semibold text-gray-400">{children}</span>
}

// ── Panel-language toggle (Req 21) ─────────────────────────────────────────────
// A segmented control matching the mockup — flag + endonym per language, the active
// option lifted onto a white "card". Scoped to this page (the shared compact ES/EN
// LanguageToggle stays in the sidebar/login) but wired to the same useI18n.changeLanguage,
// so the choice still persists per-user via POST /user/preferences.
function PanelLanguageToggle() {
  const { language, changeLanguage, t } = useI18n()
  return (
    <div
      role="group"
      aria-label={t('compliance.lang.label')}
      className="inline-flex shrink-0 gap-1 rounded-[10px] border border-gray-200 bg-gray-100 p-1 dark:border-gray-700 dark:bg-gray-800"
    >
      {LANGUAGES.map((lang) => {
        const on = language === lang
        const display = LANG_DISPLAY[lang]
        return (
          <button
            key={lang}
            type="button"
            onClick={() => changeLanguage(lang)}
            aria-pressed={on}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
              on
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-gray-50'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <span aria-hidden className="text-base leading-none">
              {display.flag}
            </span>
            {display.name}
          </button>
        )
      })}
    </div>
  )
}

// ── Posture card: an "Automatic" pill, an icon, the guarantee, and a footer that is
//    either a metric + ✓ Active pill (enforced guarantees) or a deep-link + path
//    (guarantees whose live data lives on another screen). ─────────────────────
function PostureCard({
  icon,
  iconTone = 'ok',
  titleKey,
  bodyKey,
  metricKey,
  active,
  linkHref,
  linkKey,
  path,
}: {
  icon: string
  iconTone?: 'ok' | 'warn'
  titleKey: TranslationKey
  bodyKey: TranslationKey
  metricKey?: TranslationKey
  active?: boolean
  linkHref?: string
  linkKey?: TranslationKey
  path?: string
}) {
  const { t } = useI18n()
  const iconClasses =
    iconTone === 'warn'
      ? 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
      : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
  return (
    <div className="clinic-card flex flex-col gap-2.5 bg-gray-50/40 p-4 dark:bg-gray-900/40">
      <div className="flex items-start justify-between gap-3">
        <span className={`grid h-9 w-9 place-items-center rounded-lg text-base ${iconClasses}`} aria-hidden>
          {icon}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          <span aria-hidden className="text-[8px]">
            ●
          </span>
          {t('compliance.posture.automatic')}
        </span>
      </div>
      <h3 className="text-sm font-semibold">{t(titleKey)}</h3>
      <p className="flex-1 text-xs text-gray-500 dark:text-gray-400">{t(bodyKey)}</p>
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-dashed border-gray-200 pt-2.5 dark:border-gray-700">
        {linkHref && linkKey ? (
          <Link
            href={linkHref}
            className="inline-flex items-center gap-1 text-xs font-semibold text-teal-600 hover:text-teal-700 dark:text-teal-400"
          >
            {t(linkKey)} <span aria-hidden className="text-[10px]">↗</span>
          </Link>
        ) : (
          metricKey && <span className="text-[11px] text-gray-400">{t(metricKey)}</span>
        )}
        {active ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            ✓ {t('compliance.posture.active')}
          </span>
        ) : (
          path && <span className="font-mono text-[11px] text-gray-400">{path}</span>
        )}
      </div>
    </div>
  )
}

// ── Checklist status atoms ─────────────────────────────────────────────────────
function StatusBox({ status }: { status: ResolvedStatus }) {
  const base = 'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border text-xs'
  if (status === 'done')
    return <span className={`${base} border-emerald-500 bg-emerald-500 text-white`}>✓</span>
  if (status === 'in_review')
    return <span className={`${base} border-amber-400 text-amber-500`} aria-hidden>•</span>
  if (status === 'blocked')
    return <span className={`${base} border-gray-200 bg-gray-100 text-gray-300 dark:border-gray-700 dark:bg-gray-800`} aria-hidden>🔒</span>
  return <span className={`${base} border-gray-300 dark:border-gray-600`} aria-hidden />
}

function StatusPill({ status, label }: { status: ResolvedStatus; label: string }) {
  const styles: Record<ResolvedStatus, string> = {
    done: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    in_review: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    blocked: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
    pending: 'border border-gray-200 text-gray-400 dark:border-gray-700',
  }
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${styles[status]}`}>{label}</span>
}

function statusLabel(t: (k: TranslationKey) => string, status: ResolvedStatus): string {
  switch (status) {
    case 'done':
      return t('compliance.status.done')
    case 'in_review':
      return t('compliance.status.inReview')
    case 'blocked':
      return t('compliance.status.blocked')
    default:
      return t('compliance.status.pending')
  }
}

function formatDate(iso: string, language: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(language === 'es' ? 'es-ES' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// ── Inline states for the checklist section ────────────────────────────────────
function ChecklistSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-gray-800" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-start gap-3">
          <div className="h-5 w-5 rounded-md bg-gray-100 dark:bg-gray-800" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-1/2 rounded bg-gray-100 dark:bg-gray-800" />
            <div className="h-3 w-3/4 rounded bg-gray-100 dark:bg-gray-800" />
          </div>
        </div>
      ))}
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n()
  return (
    <div className="flex items-start gap-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-red-50 text-base dark:bg-red-950" aria-hidden>
        ⚠️
      </span>
      <div>
        <div className="text-sm font-semibold">{t('compliance.error.title')}</div>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{t('compliance.error.body')}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-2.5 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-semibold hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          ↻ {t('compliance.error.retry')}
        </button>
      </div>
    </div>
  )
}

function EmptyState() {
  const { t } = useI18n()
  return (
    <div className="py-4 text-center">
      <div className="text-2xl" aria-hidden>
        🗒️
      </div>
      <div className="mt-1.5 text-sm font-semibold text-gray-600 dark:text-gray-300">{t('compliance.empty.title')}</div>
      <p className="mx-auto mt-1 max-w-sm text-xs text-gray-400">{t('compliance.empty.body')}</p>
    </div>
  )
}
