'use client'

// Admin Studio — Clinic detail (P11). One clinic, edited across sections: general
// settings, bot configuration (tone + rules), business hours, Google Calendar
// connection, and license. Bot/hours live in clinic.settings; we always PATCH a
// MERGED settings object so unrelated keys are never dropped.
import { use, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, API_BASE } from '@/shared/api/client'
import { useI18n } from '@/shared/hooks/useI18n'
import { LicenseBadge } from '@/shared/components/LicenseBadge'
import { PillToggle } from '@/shared/components/PillToggle'
import { WEEKDAYS, toBusinessHours } from '@/shared/businessHours'
import { SAFETY_RULE_KEYS } from '@/shared/botPreview'
import {
  compileActiveRules,
  parseClinicRules,
  rulesChanged,
  type ClinicRule,
} from '@/shared/clinicRules'
import { formatDateTime } from '@/shared/format'
import type {
  BusinessHours,
  Clinic,
  ClinicLicense,
  ClinicPlan,
  ClinicSettings,
  ClinicStatus,
} from '@/shared/types'

const PLANS: ClinicPlan[] = ['starter', 'pro', 'enterprise']
const STATUSES: ClinicStatus[] = ['active', 'suspended', 'cancelled']

export default function ClinicDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { t } = useI18n()

  const query = useQuery({
    queryKey: ['clinic', id],
    queryFn: () => api.get<{ clinic: Clinic }>(`/clinics/${id}`),
  })
  const clinic = query.data?.clinic

  return (
    <div className="clinic-page clinic-page-md space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{clinic?.name ?? t('studio.clinics.detail')}</h1>
      </div>

      {query.isLoading ? (
        <p className="text-sm text-gray-400">{t('common.loading')}</p>
      ) : !clinic ? (
        <p className="text-sm text-gray-400">{t('clinic.notFound')}</p>
      ) : (
        <>
          <GeneralSection clinic={clinic} />
          <BotConfigSection clinic={clinic} />
          <BusinessHoursSection clinic={clinic} />
          <BookingGridSection clinic={clinic} />
          <CalendarSection clinic={clinic} />
          <SheetsSection clinic={clinic} />
          <MessengerSection clinic={clinic} />
          <InstagramSection clinic={clinic} />
          <LicenseSection clinicId={clinic.id} />
        </>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="clinic-card p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  )
}

const inputCls =
  'rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800'

function useSaveClinic(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/clinics/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clinic', id] })
      qc.invalidateQueries({ queryKey: ['clinics'] })
    },
  })
}

function GeneralSection({ clinic }: { clinic: Clinic }) {
  const { t } = useI18n()
  const [name, setName] = useState(clinic.name)
  const [plan, setPlan] = useState<ClinicPlan>(clinic.plan)
  const [status, setStatus] = useState<ClinicStatus>(clinic.status)
  const [timezone, setTimezone] = useState(clinic.timezone)
  const [address, setAddress] = useState(clinic.address ?? '')
  const [phone, setPhone] = useState(clinic.phone ?? '')
  const [clinicType, setClinicType] = useState(clinic.clinicType ?? '')
  const save = useSaveClinic(clinic.id)

  const dirty =
    name !== clinic.name ||
    plan !== clinic.plan ||
    status !== clinic.status ||
    timezone !== clinic.timezone ||
    address !== (clinic.address ?? '') ||
    phone !== (clinic.phone ?? '') ||
    clinicType !== (clinic.clinicType ?? '')

  return (
    <Section title={t('clinic.section.general')}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <Field label={t('studio.clinics.name')}>
          <input value={name} onChange={(e) => setName(e.target.value)} className={`w-full ${inputCls}`} />
        </Field>
        <Field label={t('studio.clinics.slug')}>
          <input value={clinic.slug} disabled className={`w-full ${inputCls} opacity-60`} />
        </Field>
        <Field label={t('studio.clinics.plan')}>
          <select value={plan} onChange={(e) => setPlan(e.target.value as ClinicPlan)} className={`w-full ${inputCls}`}>
            {PLANS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('studio.clinics.status')}>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ClinicStatus)}
            className={`w-full ${inputCls}`}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('studio.clinics.timezone')}>
          <input value={timezone} onChange={(e) => setTimezone(e.target.value)} className={`w-full ${inputCls}`} />
        </Field>
        <Field label={t('studio.clinics.address')}>
          <input value={address} onChange={(e) => setAddress(e.target.value)} className={`w-full ${inputCls}`} />
        </Field>
        <Field label={t('studio.clinics.phone')}>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={`w-full ${inputCls}`} />
        </Field>
        <Field label={t('studio.clinics.clinicType')}>
          <input
            value={clinicType}
            onChange={(e) => setClinicType(e.target.value)}
            placeholder={t('studio.clinics.clinicTypePlaceholder')}
            className={`w-full ${inputCls}`}
          />
        </Field>
      </div>
      <SaveBar
        dirty={dirty}
        pending={save.isPending}
        saved={save.isSuccess && !dirty}
        onSave={() => save.mutate({ name, plan, status, timezone, address, phone, clinicType })}
      />
    </Section>
  )
}

function BotConfigSection({ clinic }: { clinic: Clinic }) {
  const { t } = useI18n()
  const settings = clinic.settings as ClinicSettings
  // Clinic rules as a structured list with a per-rule active/inactive toggle
  // (Screen 8 brief). Compare against the freshly-parsed persisted list each render
  // so the section flips back to "saved" after the clinic refetches.
  const persistedRules = parseClinicRules(settings)
  const [rules, setRules] = useState<ClinicRule[]>(persistedRules)
  const [unmatchedEs, setUnmatchedEs] = useState(settings.unmatchedKeywordMessage?.es ?? '')
  const [unmatchedEn, setUnmatchedEn] = useState(settings.unmatchedKeywordMessage?.en ?? '')
  const save = useSaveClinic(clinic.id)

  const dirty =
    rulesChanged(rules, persistedRules) ||
    unmatchedEs !== (settings.unmatchedKeywordMessage?.es ?? '') ||
    unmatchedEn !== (settings.unmatchedKeywordMessage?.en ?? '')

  function updateRule(id: string, patch: Partial<ClinicRule>) {
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }
  function deleteRule(id: string) {
    setRules((rs) => rs.filter((r) => r.id !== id))
  }
  function addRule(text: string) {
    setRules((rs) => [...rs, { id: crypto.randomUUID(), text: text.trim(), active: true }])
  }

  function onSave() {
    save.mutate({
      settings: {
        ...clinic.settings,
        // The bot reads the flat string; recompile it from the ACTIVE rules so an
        // inactive rule disappears from the prompt without losing its text.
        clinicRules: compileActiveRules(rules),
        clinicRulesList: rules,
        // Blank fields fall back to the built-in default text at send time
        // (resolveUnmatchedKeywordMessage), so an empty string is a valid,
        // intentional "use the default" value, not an error.
        unmatchedKeywordMessage: { es: unmatchedEs.trim(), en: unmatchedEn.trim() },
      },
    })
  }

  return (
    <Section title={t('clinic.section.bot')}>
      {/* Mode banner (Req 20) — the assistant answers automatically and hands off to a
          human on urgent messages / on request. Stated up front so the operating mode
          is unmistakable before any tone or rule is touched. */}
      <div className="mb-4 flex flex-col gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/40 sm:flex-row sm:items-center">
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
            🤖 {t('bot.mode.botName')} · {t('bot.mode.botState')}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            👤 {t('bot.mode.humanName')} · {t('bot.mode.humanState')}
          </span>
        </div>
        <p className="text-[11px] leading-snug text-emerald-800 dark:text-emerald-300">{t('bot.mode.banner')}</p>
      </div>

      {/* Bot tone/language moved to Studio → AI Settings (items 3/9/16 of the 25-item
          batch) — edit them there; this link keeps the connection discoverable from
          the page an admin is used to looking at. */}
      <Link
        href="/studio/ai-settings"
        className="mb-4 flex items-center justify-between gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-800 hover:bg-teal-100 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-200 dark:hover:bg-teal-950/70"
      >
        <span>{t('clinic.aiSettingsMoved')}</span>
        <span aria-hidden>→</span>
      </Link>

      {/* Non-removable safety rules (Req 20) — presented before the editable rules so
          it is unmistakable that these are always enforced on top of clinic rules. */}
      <SafetyRulesCard />

      {/* Clinic-rule editor (Req 27) — each rule toggles active/inactive; only active
          rules reach the bot. Sits below the always-on safety rules. */}
      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-gray-500">{t('bot.rules.title')}</p>
          {rules.length > 0 && (
            <span className="text-[11px] text-gray-400">
              {t('bot.rules.activeCount', {
                active: rules.filter((r) => r.active).length,
                total: rules.length,
              })}
            </span>
          )}
        </div>
        <p className="mb-2 text-xs text-gray-400">{t('bot.rules.hint')}</p>

        {rules.length === 0 ? (
          <p className="rounded-md border border-dashed border-gray-300 px-3 py-4 text-center text-xs text-gray-400 dark:border-gray-700">
            {t('bot.rules.empty')}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {rules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                onToggle={() => updateRule(rule.id, { active: !rule.active })}
                onChangeText={(text) => updateRule(rule.id, { text })}
                onDelete={() => deleteRule(rule.id)}
              />
            ))}
          </ul>
        )}

        <AddRuleForm onAdd={addRule} />
      </div>

      {/* Unmatched-keyword nudge (Req 34) — the literal, non-LLM message sent when a
          patient's message matches no configured workflow/custom-flow keyword, any
          time of day. Editable per language; a blank field keeps the built-in default. */}
      <div className="mt-4">
        <p className="mb-1 text-xs font-medium text-gray-500">{t('bot.unmatched.title')}</p>
        <p className="mb-2 text-xs text-gray-400">{t('bot.unmatched.hint')}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-gray-400">
              {t('bot.unmatched.esLabel')}
            </label>
            <textarea
              value={unmatchedEs}
              onChange={(e) => setUnmatchedEs(e.target.value)}
              placeholder={t('bot.unmatched.esDefault')}
              rows={2}
              className={`${inputCls} w-full resize-y`}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-gray-400">
              {t('bot.unmatched.enLabel')}
            </label>
            <textarea
              value={unmatchedEn}
              onChange={(e) => setUnmatchedEn(e.target.value)}
              placeholder={t('bot.unmatched.enDefault')}
              rows={2}
              className={`${inputCls} w-full resize-y`}
            />
          </div>
        </div>
      </div>

      {/* Mode & handoff summary (Req 20) — bot mode, human takeover, and the always-on
          urgent→handoff override, each in its own status colour so they're unmistakable. */}
      <ModeHandoffCard />

      <SaveBar
        dirty={dirty}
        pending={save.isPending}
        saved={save.isSuccess && !dirty}
        error={save.isError}
        onSave={onSave}
      />
    </Section>
  )
}

// Read-only presentation of the always-enforced safety rules (Req 20). The enforcing
// logic lives in @docmee/agents (clinic-bot system prompt + outbound medical-safety
// screen); this card only states the guarantee and makes clear it cannot be removed.
function SafetyRulesCard() {
  const { t } = useI18n()
  return (
    <div className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/40">
      <div className="mb-2 flex items-center gap-2">
        <span aria-hidden className="text-emerald-600 dark:text-emerald-400">
          🔒
        </span>
        <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
          {t('bot.safety.title')}
        </span>
        <span className="rounded-full border border-emerald-400 px-1.5 py-0.5 text-[10px] font-medium uppercase text-emerald-700 dark:border-emerald-700 dark:text-emerald-300">
          {t('bot.safety.locked')}
        </span>
      </div>
      <ul className="space-y-1">
        {SAFETY_RULE_KEYS.map((key) => (
          <li key={key} className="flex gap-2 text-xs text-emerald-900 dark:text-emerald-200">
            <span aria-hidden className="text-emerald-500">
              ✓
            </span>
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-emerald-700/80 dark:text-emerald-400/80">
        {t('bot.safety.subtitle')}
      </p>
    </div>
  )
}

// Mode & handoff summary (Req 20). The actual mode lives per-conversation in the inbox
// (the bot answers; secretaries take over; urgent threads are flagged and assigned by the
// agents layer) — this card states the guarantees so bot mode, human mode and the urgent
// override read unmistakably from the config surface.
function ModeHandoffCard() {
  const { t } = useI18n()
  const rows = [
    {
      icon: '🤖',
      name: t('bot.mode.botName'),
      state: t('bot.mode.botState'),
      desc: t('bot.mode.botDesc'),
      tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
      ring: 'border-gray-200 dark:border-gray-800',
    },
    {
      icon: '👤',
      name: t('bot.mode.humanName'),
      state: t('bot.mode.humanState'),
      desc: t('bot.mode.humanDesc'),
      tone: 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
      ring: 'border-gray-200 dark:border-gray-800',
    },
    {
      icon: '🚨',
      name: t('bot.mode.urgentName'),
      state: t('bot.mode.urgentState'),
      desc: t('bot.mode.urgentDesc'),
      tone: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
      ring: 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30',
    },
  ]
  return (
    <div className="mt-4">
      <p className="mb-2 text-xs font-medium text-gray-500">{t('bot.mode.title')}</p>
      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li
            key={row.name}
            className={`flex items-start gap-2.5 rounded-lg border p-2.5 ${row.ring}`}
          >
            <span aria-hidden className="mt-0.5 text-base leading-none">
              {row.icon}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                {row.name}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${row.tone}`}
                >
                  {row.state}
                </span>
              </p>
              <p className="mt-0.5 text-xs text-gray-500">{row.desc}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

// One editable clinic rule with an active/inactive toggle. An inactive rule is dimmed
// and carries an "Inactive" badge — it stays in the list for later but is excluded
// from what the bot sees (compileActiveRules drops it on save).
function RuleRow({
  rule,
  onToggle,
  onChangeText,
  onDelete,
}: {
  rule: ClinicRule
  onToggle: () => void
  onChangeText: (text: string) => void
  onDelete: () => void
}) {
  const { t } = useI18n()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(rule.text)

  function commit() {
    const next = draft.trim()
    if (next !== '' && next !== rule.text) onChangeText(next)
    else setDraft(rule.text)
    setEditing(false)
  }

  return (
    <li
      className={`flex items-start gap-2 rounded-lg border p-2 ${
        rule.active
          ? 'border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900'
          : 'border-gray-200 bg-gray-50 opacity-70 dark:border-gray-800 dark:bg-gray-950/40'
      }`}
    >
      <div className="mt-0.5 shrink-0">
        <PillToggle
          checked={rule.active}
          label={rule.active ? t('bot.rules.deactivate') : t('bot.rules.activate')}
          onChange={onToggle}
          size="sm"
        />
      </div>

      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              setDraft(rule.text)
              setEditing(false)
            }
          }}
          className={`min-w-0 flex-1 ${inputCls}`}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft(rule.text)
            setEditing(true)
          }}
          className="min-w-0 flex-1 break-words text-left text-sm hover:text-teal-600"
        >
          {rule.text}
        </button>
      )}

      <button
        type="button"
        onClick={onDelete}
        title={t('common.delete')}
        aria-label={t('common.delete')}
        className="mt-0.5 shrink-0 rounded-md border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
      >
        ✕
      </button>
    </li>
  )
}

// Add a new clinic rule to the list. New rules start active.
function AddRuleForm({ onAdd }: { onAdd: (text: string) => void }) {
  const { t } = useI18n()
  const [text, setText] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    if (text.trim()) {
      onAdd(text)
      setText('')
    }
  }

  return (
    <form onSubmit={submit} className="mt-2 flex gap-2">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('bot.rules.placeholder')}
        className={`min-w-0 flex-1 ${inputCls}`}
      />
      <button
        type="submit"
        disabled={!text.trim()}
        className="shrink-0 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-semibold hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"
      >
        {t('bot.rules.add')}
      </button>
    </form>
  )
}

function BusinessHoursSection({ clinic }: { clinic: Clinic }) {
  const { t } = useI18n()
  const settings = clinic.settings as ClinicSettings
  const [hours, setHours] = useState<BusinessHours>(() => toBusinessHours(settings.businessHours))
  const save = useSaveClinic(clinic.id)
  const [touched, setTouched] = useState(false)

  function update(day: string, patch: Partial<BusinessHours[string]>) {
    setTouched(true)
    setHours((h) => ({ ...h, [day]: { ...h[day]!, ...patch } }))
  }

  function onSave() {
    save.mutate({ settings: { ...clinic.settings, businessHours: hours } })
    setTouched(false)
  }

  return (
    <Section title={t('clinic.section.hours')}>
      <div className="space-y-1.5">
        {WEEKDAYS.map((day) => {
          const d = hours[day]!
          return (
            <div key={day} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-24 text-gray-600 dark:text-gray-400">{t(`hours.day.${day}` as const)}</span>
              <PillToggle
                checked={!d.closed}
                label={`${t(`hours.day.${day}` as const)} ${d.closed ? t('hours.closed') : t('hours.open')}`}
                onChange={(isOpen) => update(day, { closed: !isOpen })}
                onLabel={t('hours.open')}
                offLabel={t('hours.closed')}
                size="sm"
              />
              <input
                type="time"
                value={d.open}
                disabled={d.closed}
                onChange={(e) => update(day, { open: e.target.value })}
                className={`${inputCls} disabled:opacity-40`}
              />
              <span className="text-gray-400">–</span>
              <input
                type="time"
                value={d.close}
                disabled={d.closed}
                onChange={(e) => update(day, { close: e.target.value })}
                className={`${inputCls} disabled:opacity-40`}
              />
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-gray-400">{t('hours.hint')}</p>
      <SaveBar
        dirty={touched}
        pending={save.isPending}
        saved={save.isSuccess && !touched}
        onSave={onSave}
      />
    </Section>
  )
}

// CRE-47: per-clinic booking grid — bookable hours + slot length. Read by the
// scheduling worker (settings.bookingGrid) to drive computeFreeSlots; defaults to
// 09:00–18:00 / 30-min when unset.
function BookingGridSection({ clinic }: { clinic: Clinic }) {
  const { t } = useI18n()
  const settings = clinic.settings as ClinicSettings
  const grid = settings.bookingGrid
  const [startHour, setStartHour] = useState<number>(grid?.startHour ?? 9)
  const [endHour, setEndHour] = useState<number>(grid?.endHour ?? 18)
  const [slotMinutes, setSlotMinutes] = useState<number>(grid?.slotMinutes ?? 30)
  const [touched, setTouched] = useState(false)
  const save = useSaveClinic(clinic.id)

  const valid = startHour >= 0 && endHour <= 24 && startHour < endHour && slotMinutes > 0

  function onSave() {
    if (!valid) return
    save.mutate({ settings: { ...clinic.settings, bookingGrid: { startHour, endHour, slotMinutes } } })
    setTouched(false)
  }

  return (
    <Section title={t('clinic.section.bookingGrid')}>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">{t('bookingGrid.start')}</span>
          <input
            type="number"
            min={0}
            max={23}
            value={startHour}
            onChange={(e) => {
              setTouched(true)
              setStartHour(Number(e.target.value))
            }}
            className={`${inputCls} w-20`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">{t('bookingGrid.end')}</span>
          <input
            type="number"
            min={1}
            max={24}
            value={endHour}
            onChange={(e) => {
              setTouched(true)
              setEndHour(Number(e.target.value))
            }}
            className={`${inputCls} w-20`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">{t('bookingGrid.slot')}</span>
          <input
            type="number"
            min={5}
            step={5}
            value={slotMinutes}
            onChange={(e) => {
              setTouched(true)
              setSlotMinutes(Number(e.target.value))
            }}
            className={`${inputCls} w-24`}
          />
        </label>
      </div>
      <p className="mt-2 text-xs text-gray-400">{t('bookingGrid.hint')}</p>
      {!valid && <p className="mt-1 text-xs text-red-600">{t('bookingGrid.invalid')}</p>}
      <SaveBar
        dirty={touched && valid}
        pending={save.isPending}
        saved={save.isSuccess && !touched}
        error={save.isError}
        onSave={onSave}
      />
    </Section>
  )
}

function CalendarSection({ clinic }: { clinic: Clinic }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const settings = clinic.settings as ClinicSettings
  const connected = Boolean(settings.googleCalendar)
  const [showReadiness, setShowReadiness] = useState(false)
  // The API begins the OAuth flow with a redirect; open it in the same tab.
  const authUrl = `${API_BASE}/clinic/${clinic.id}/calendar/auth`

  // Disconnect drops the stored tokens server-side; re-read the clinic so the
  // badge flips back to "Not connected" and the bot stops booking.
  const disconnect = useMutation({
    mutationFn: () => api.del(`/clinic/${clinic.id}/calendar/disconnect`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clinic', clinic.id] })
      qc.invalidateQueries({ queryKey: ['clinics'] })
    },
  })

  return (
    <Section title={t('clinic.section.calendar')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setShowReadiness((v) => !v)}
          aria-label="Show booking system readiness"
          aria-expanded={showReadiness}
          className="grid h-7 w-7 place-items-center rounded-full border border-gray-300 text-xs font-semibold text-gray-500 hover:border-teal-300 hover:text-teal-600 dark:border-gray-700 dark:text-gray-400"
        >
          i
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {connected && (
            <button
              type="button"
              disabled={disconnect.isPending}
              onClick={() => {
                if (window.confirm(t('calendar.disconnectConfirm'))) disconnect.mutate()
              }}
              className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:hover:bg-red-950"
            >
              {disconnect.isPending ? t('calendar.disconnecting') : t('calendar.disconnect')}
            </button>
          )}
          <a
            href={authUrl}
            className="rounded-md bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700"
          >
            {connected ? t('calendar.reconnect') : t('calendar.connect')}
          </a>
        </div>
      </div>
      {showReadiness && (
        <div className="clinic-card mt-3 bg-gray-50 p-3 dark:bg-gray-900/50">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              connected
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                : 'bg-gray-100 text-gray-500 dark:bg-gray-800'
            }`}
          >
            {connected ? t('calendar.connected') : t('calendar.notConnected')}
          </span>
          <p className="mt-2 text-xs text-gray-400">{t('calendar.hint')}</p>
        </div>
      )}
    </Section>
  )
}

function SheetsSection({ clinic }: { clinic: Clinic }) {
  const { t } = useI18n()
  const settings = clinic.settings as ClinicSettings
  const sheets = settings.googleSheets ?? {}
  const calendarConnected = Boolean(settings.googleCalendar)
  const [enabled, setEnabled] = useState(Boolean(sheets.enabled))
  const [spreadsheetId, setSpreadsheetId] = useState(sheets.spreadsheetId ?? '')
  const [sheetName, setSheetName] = useState(sheets.sheetName ?? '')
  const save = useSaveClinic(clinic.id)

  const dirty =
    enabled !== Boolean(sheets.enabled) ||
    spreadsheetId !== (sheets.spreadsheetId ?? '') ||
    sheetName !== (sheets.sheetName ?? '')

  function onSave() {
    save.mutate({
      settings: {
        ...clinic.settings,
        googleSheets: {
          ...sheets,
          enabled,
          spreadsheetId: spreadsheetId.trim(),
          sheetName: sheetName.trim(),
        },
      },
    })
  }

  return (
    <Section title={t('clinic.section.sheets')}>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>{t('sheets.enable')}</span>
        <PillToggle checked={enabled} label={t('sheets.enable')} onChange={setEnabled} />
      </label>
      <div className="mt-3 space-y-2">
        <Field label={t('sheets.spreadsheetId')}>
          <input
            value={spreadsheetId}
            onChange={(e) => setSpreadsheetId(e.target.value)}
            placeholder="1AbC…xyz"
            className={`w-full ${inputCls}`}
          />
        </Field>
        <Field label={t('sheets.sheetName')}>
          <input
            value={sheetName}
            onChange={(e) => setSheetName(e.target.value)}
            placeholder="CRM"
            className={`w-full ${inputCls}`}
          />
        </Field>
      </div>
      {!calendarConnected && <p className="mt-2 text-xs text-amber-600">{t('sheets.needsGoogle')}</p>}
      <p className="mt-2 text-xs text-gray-400">{t('sheets.hint')}</p>
      <SaveBar
        dirty={dirty}
        pending={save.isPending}
        saved={save.isSuccess && !dirty}
        onSave={onSave}
      />
    </Section>
  )
}

function MessengerSection({ clinic }: { clinic: Clinic }) {
  const { t } = useI18n()
  const settings = clinic.settings as ClinicSettings
  const [enabled, setEnabled] = useState(Boolean(clinic.messengerEnabled))
  const [pageId, setPageId] = useState(clinic.messengerPageId ?? '')
  const [verifyToken, setVerifyToken] = useState(clinic.messengerWebhookVerifyToken ?? '')
  const [token, setToken] = useState('') // write-only; empty keeps the stored token
  // Token-expiry date (Req 19) — drives the META_TOKEN_EXPIRING alert. Date inputs
  // use 'YYYY-MM-DD'; we keep just that day part of any stored ISO value.
  const [expiry, setExpiry] = useState((settings.messengerTokenExpiresAt ?? '').slice(0, 10))
  const [tested, setTested] = useState<boolean | null>(null)
  const save = useSaveClinic(clinic.id)

  const dirty =
    enabled !== Boolean(clinic.messengerEnabled) ||
    pageId !== (clinic.messengerPageId ?? '') ||
    verifyToken !== (clinic.messengerWebhookVerifyToken ?? '') ||
    expiry !== (settings.messengerTokenExpiresAt ?? '').slice(0, 10) ||
    token.trim() !== ''

  const webhookUrl = `${API_BASE}/webhook/messenger`

  function onSave() {
    const body: Record<string, unknown> = {
      messengerEnabled: enabled,
      messengerPageId: pageId.trim(),
      messengerWebhookVerifyToken: verifyToken.trim(),
      // Merge so unrelated settings keys are never dropped; clear when blanked.
      settings: { ...clinic.settings, messengerTokenExpiresAt: expiry || undefined },
    }
    // Only send the token when the admin typed a new one — empty preserves it.
    if (token.trim()) body.messengerPageAccessToken = token.trim()
    save.mutate(body, { onSuccess: () => setToken('') })
  }

  // Local readiness check — confirms the connection is fully configured.
  async function onTest() {
    try {
      const res = await api.post<{ ok: boolean }>(`/clinics/${clinic.id}/messenger/test`, {})
      setTested(Boolean(res.ok))
    } catch {
      setTested(false)
    }
  }

  return (
    <Section title={t('clinic.section.messenger')}>
      <label className="mb-3 flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{t('messenger.enable')}</span>
        <PillToggle checked={enabled} label={t('messenger.enable')} onChange={setEnabled} />
      </label>
      <p className="mb-3 text-xs text-gray-500">{t('messenger.enableHint')}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t('messenger.pageId')}>
          <input value={pageId} onChange={(e) => setPageId(e.target.value)} className={`w-full ${inputCls}`} />
        </Field>
        <Field label={t('messenger.verifyToken')}>
          <input
            value={verifyToken}
            onChange={(e) => setVerifyToken(e.target.value)}
            className={`w-full ${inputCls}`}
          />
        </Field>
        <Field label={t('messenger.pageToken')}>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={clinic.messengerPageId ? '••••••••' : ''}
            className={`w-full ${inputCls}`}
          />
        </Field>
        <Field label={t('messenger.tokenExpiry')}>
          <input
            type="date"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            className={`w-full ${inputCls}`}
          />
        </Field>
      </div>
      <p className="mt-1 text-xs text-gray-400">{t('messenger.pageTokenHint')}</p>
      <p className="mt-1 text-xs text-gray-400">{t('messenger.tokenExpiryHint')}</p>
      <p className="mt-1 text-xs text-gray-400">{t('messenger.hint', { url: webhookUrl })}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || save.isPending}
          className="rounded-md bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-900 disabled:opacity-40 dark:bg-gray-700"
        >
          {save.isPending ? t('common.saving') : t('common.save')}
        </button>
        <button
          type="button"
          onClick={onTest}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold hover:border-gray-400 dark:border-gray-700"
        >
          {t('messenger.test')}
        </button>
        {tested === true && <span className="text-xs text-emerald-600">{t('messenger.testOk')}</span>}
        {tested === false && <span className="text-xs text-red-600">{t('messenger.testFail')}</span>}
        {save.isSuccess && !dirty && <span className="text-xs text-emerald-600">{t('common.saved')}</span>}
      </div>
    </Section>
  )
}

function InstagramSection({ clinic }: { clinic: Clinic }) {
  const { t } = useI18n()
  const settings = clinic.settings as ClinicSettings
  const [enabled, setEnabled] = useState(Boolean(clinic.instagramEnabled))
  const [accountId, setAccountId] = useState(clinic.instagramAccountId ?? '')
  const [verifyToken, setVerifyToken] = useState(clinic.instagramWebhookVerifyToken ?? '')
  const [token, setToken] = useState('') // write-only; empty keeps the stored token
  // Token-expiry date (Req 19) — drives the META_TOKEN_EXPIRING alert.
  const [expiry, setExpiry] = useState((settings.instagramTokenExpiresAt ?? '').slice(0, 10))
  const [tested, setTested] = useState<boolean | null>(null)
  const save = useSaveClinic(clinic.id)

  const dirty =
    enabled !== Boolean(clinic.instagramEnabled) ||
    accountId !== (clinic.instagramAccountId ?? '') ||
    verifyToken !== (clinic.instagramWebhookVerifyToken ?? '') ||
    expiry !== (settings.instagramTokenExpiresAt ?? '').slice(0, 10) ||
    token.trim() !== ''

  const webhookUrl = `${API_BASE}/webhook/instagram`

  function onSave() {
    const body: Record<string, unknown> = {
      instagramEnabled: enabled,
      instagramAccountId: accountId.trim(),
      instagramWebhookVerifyToken: verifyToken.trim(),
      // Merge so unrelated settings keys are never dropped; clear when blanked.
      settings: { ...clinic.settings, instagramTokenExpiresAt: expiry || undefined },
    }
    // Only send the token when the admin typed a new one — empty preserves it.
    if (token.trim()) body.instagramPageAccessToken = token.trim()
    save.mutate(body, { onSuccess: () => setToken('') })
  }

  // Local readiness check — confirms the connection is fully configured.
  async function onTest() {
    try {
      const res = await api.post<{ ok: boolean }>(`/clinics/${clinic.id}/instagram/test`, {})
      setTested(Boolean(res.ok))
    } catch {
      setTested(false)
    }
  }

  return (
    <Section title={t('clinic.section.instagram')}>
      <label className="mb-3 flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{t('instagram.enable')}</span>
        <PillToggle checked={enabled} label={t('instagram.enable')} onChange={setEnabled} />
      </label>
      <p className="mb-3 text-xs text-gray-500">{t('instagram.enableHint')}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t('instagram.accountId')}>
          <input value={accountId} onChange={(e) => setAccountId(e.target.value)} className={`w-full ${inputCls}`} />
        </Field>
        <Field label={t('instagram.verifyToken')}>
          <input
            value={verifyToken}
            onChange={(e) => setVerifyToken(e.target.value)}
            className={`w-full ${inputCls}`}
          />
        </Field>
        <Field label={t('instagram.pageToken')}>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={clinic.instagramAccountId ? '••••••••' : ''}
            className={`w-full ${inputCls}`}
          />
        </Field>
        <Field label={t('instagram.tokenExpiry')}>
          <input
            type="date"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            className={`w-full ${inputCls}`}
          />
        </Field>
      </div>
      <p className="mt-1 text-xs text-gray-400">{t('instagram.pageTokenHint')}</p>
      <p className="mt-1 text-xs text-gray-400">{t('instagram.tokenExpiryHint')}</p>
      <p className="mt-1 text-xs text-gray-400">{t('instagram.hint', { url: webhookUrl })}</p>
      <p className="mt-1 text-xs text-gray-400">{t('instagram.note')}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || save.isPending}
          className="rounded-md bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-900 disabled:opacity-40 dark:bg-gray-700"
        >
          {save.isPending ? t('common.saving') : t('common.save')}
        </button>
        <button
          type="button"
          onClick={onTest}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold hover:border-gray-400 dark:border-gray-700"
        >
          {t('instagram.test')}
        </button>
        {tested === true && <span className="text-xs text-emerald-600">{t('instagram.testOk')}</span>}
        {tested === false && <span className="text-xs text-red-600">{t('instagram.testFail')}</span>}
        {save.isSuccess && !dirty && <span className="text-xs text-emerald-600">{t('common.saved')}</span>}
      </div>
    </Section>
  )
}

function LicenseSection({ clinicId }: { clinicId: string }) {
  const { t, language } = useI18n()
  const qc = useQueryClient()
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['license', clinicId],
    queryFn: () => api.get<{ license: ClinicLicense }>(`/clinics/${clinicId}/license`),
  })
  const license = query.data?.license

  const save = useMutation({
    mutationFn: () => api.post(`/clinics/${clinicId}/license`, { licenseKey: key.trim() }),
    onSuccess: () => {
      setKey('')
      setError(null)
      qc.invalidateQueries({ queryKey: ['license', clinicId] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (key.trim()) save.mutate()
  }

  return (
    <Section title={t('clinic.section.license')}>
      {query.isLoading ? (
        <p className="text-sm text-gray-400">{t('common.loading')}</p>
      ) : license ? (
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <LicenseBadge state={license.state} />
          {license.seats !== undefined && (
            <span className="text-gray-500">
              {t('license.seats')}: <span className="text-gray-800 dark:text-gray-200">{license.seats}</span>
            </span>
          )}
          {license.expiresAt && (
            <span className="text-gray-500">
              {t('license.expiresAt')}:{' '}
              <span className="text-gray-800 dark:text-gray-200">
                {formatDateTime(license.expiresAt, language)}
              </span>
            </span>
          )}
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={t('license.keyPlaceholder')}
          className={`flex-1 ${inputCls}`}
        />
        <button
          type="submit"
          disabled={save.isPending || !key.trim()}
          className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
        >
          {license && license.state !== 'none' ? t('license.renew') : t('license.add')}
        </button>
      </form>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      <p className="mt-2 text-xs text-gray-400">{t('license.never')}</p>
    </Section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-gray-500">{label}</span>
      {children}
    </label>
  )
}

function SaveBar({
  dirty,
  pending,
  saved,
  error = false,
  onSave,
}: {
  dirty: boolean
  pending: boolean
  saved: boolean
  error?: boolean
  onSave: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={onSave}
        disabled={!dirty || pending}
        className="rounded-md bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-900 disabled:opacity-40 dark:bg-gray-700"
      >
        {/* On a failed save the edits are kept and the button re-reads "Retry". */}
        {pending ? t('common.saving') : error ? t('common.retry') : t('common.save')}
      </button>
      {saved && <span className="text-xs text-emerald-600">{t('common.saved')}</span>}
      {error && !pending && <span className="text-xs text-red-600">⚠️ {t('common.saveFailed')}</span>}
    </div>
  )
}
