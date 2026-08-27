'use client'

// Studio — AI Settings (items 3, 9, 16 of the 25-item batch). Single home for
// every genuinely AI-related clinic setting, previously scattered across three
// places: bot tone/language lived in BOTH Clinic Detail's Bot Config section and
// the superuser-only Channels page (two editors for the same two settings.
// botTone/botLanguage keys), and the J.zel AI-provider-key cards lived at the
// bottom of the Channels integrations panel. All non-AI fields that used to sit
// next to these (clinic rules, unmatched-keyword message, safety rules, booking
// grid, Google Calendar/Sheets, license, review link, etc.) stay where they were
// — only the AI-specific settings moved here.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { ClinicSelect } from '@/shared/components/ClinicSelect'
import { AiProvidersPanel } from '@/shared/components/StudioIntegrationsPanel'
import { PillToggle } from '@/shared/components/PillToggle'
import { useI18n } from '@/shared/hooks/useI18n'
import { useActiveClinic } from '@/shared/hooks/useActiveClinic'
import { useAuthStore } from '@/shared/store/auth'
import { tonePreview } from '@/shared/botPreview'
import {
  CHAT_PROVIDERS,
  INTENT_PROVIDERS,
  EMBED_PROVIDERS,
  MODEL_SUGGESTIONS,
  DEFAULT_CHAT_MODEL,
  readAiAssistant,
  type AiAssistantConfig,
  type ChatProvider,
  type IntentProvider,
  type EmbedProvider,
} from '@/shared/aiAssistant'
import type { BotLanguage, BotTone, Clinic, ClinicSettings } from '@/shared/types'

const TONES: BotTone[] = ['professional', 'friendly', 'brief']
const BOT_LANGUAGES: BotLanguage[] = ['auto', 'es', 'en']

const inputCls = 'rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="clinic-card p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
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
        {pending ? t('common.saving') : error ? t('common.retry') : t('common.save')}
      </button>
      {saved && <span className="text-xs text-emerald-600">{t('common.saved')}</span>}
      {error && !pending && <span className="text-xs text-red-600">⚠️ {t('common.saveFailed')}</span>}
    </div>
  )
}

// Sample patient/bot exchange that re-renders as the tone or language changes.
// Mirrors the preview that used to live on Clinic Detail's Bot Config section.
function TonePreviewCard({
  tone,
  language,
  showAutoNote,
}: {
  tone: BotTone
  language: 'es' | 'en'
  showAutoNote: boolean
}) {
  const { t } = useI18n()
  const sample = tonePreview(tone, language)
  return (
    <div className="clinic-card mt-3 bg-gray-50 p-3 dark:bg-gray-950/40">
      <p className="mb-2 text-xs font-medium text-gray-500">{t('bot.preview.title')}</p>
      <div className="space-y-1.5">
        <div className="flex justify-start">
          <div className="max-w-[80%] rounded-2xl rounded-bl-sm bg-white px-3 py-1.5 text-sm shadow-sm dark:bg-gray-800">
            <span className="mb-0.5 block text-[10px] font-medium uppercase text-gray-400">
              {t('bot.preview.patient')}
            </span>
            {sample.patient}
          </div>
        </div>
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-teal-600 px-3 py-1.5 text-sm text-white">
            <span className="mb-0.5 block text-[10px] font-medium uppercase text-teal-200">
              {t('bot.preview.bot')}
            </span>
            {sample.bot}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          ✓ {t('bot.preview.tagBooking')}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          ✓ {t('bot.preview.tagNoAdvice')}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-800 dark:text-emerald-300">
          🔒 {t('bot.preview.tagSafe')}
        </span>
      </div>
      {showAutoNote && <p className="mt-2 text-[11px] text-gray-400">{t('bot.preview.autoNote')}</p>}
    </div>
  )
}

function BotToneLanguageSection({ clinic }: { clinic: Clinic }) {
  const { t, language: panelLanguage } = useI18n()
  const qc = useQueryClient()
  const settings = clinic.settings as ClinicSettings
  const [tone, setTone] = useState<BotTone>(settings.botTone ?? 'professional')
  const [language, setLanguage] = useState<BotLanguage>(settings.botLanguage ?? 'auto')
  const previewLanguage = language === 'auto' ? panelLanguage : language

  const dirty = tone !== (settings.botTone ?? 'professional') || language !== (settings.botLanguage ?? 'auto')

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/clinics/${clinic.id}`, {
        settings: { ...clinic.settings, botTone: tone, botLanguage: language },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clinic', clinic.id] })
      qc.invalidateQueries({ queryKey: ['clinics'] })
    },
  })

  return (
    <Section title={t('clinic.section.bot')}>
      <p className="mb-2 text-xs font-medium text-gray-500">{t('bot.tone.title')}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {TONES.map((value) => {
          const active = tone === value
          return (
            <button
              key={value}
              type="button"
              onClick={() => setTone(value)}
              className={`rounded-lg border p-3 text-left ${
                active
                  ? 'border-teal-500 bg-teal-50 dark:bg-teal-950'
                  : 'border-gray-200 hover:border-gray-300 dark:border-gray-800'
              }`}
            >
              <p className="text-sm font-semibold">{t(`bot.tone.${value}` as const)}</p>
              <p className="mt-1 text-xs text-gray-500">{t(`bot.tone.${value}Hint` as const)}</p>
            </button>
          )
        })}
      </div>

      <TonePreviewCard tone={tone} language={previewLanguage} showAutoNote={language === 'auto'} />

      <div className="mt-4">
        <p className="mb-1 text-xs font-medium text-gray-500">{t('bot.language.title')}</p>
        <select value={language} onChange={(e) => setLanguage(e.target.value as BotLanguage)} className={inputCls}>
          {BOT_LANGUAGES.map((value) => (
            <option key={value} value={value}>
              {t(`bot.language.${value}` as const)}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-400">{t('bot.language.hint')}</p>
      </div>

      <SaveBar dirty={dirty} pending={save.isPending} saved={save.isSuccess && !dirty} error={save.isError} onSave={() => save.mutate()} />
    </Section>
  )
}

const field = 'w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800'

// AI Assistant (J.zel) — per-clinic model / persona / knowledge sources. Moved
// here from the Automation Center page (items 3/9/16 of the 25-item batch) — it
// is genuinely AI configuration, distinct from the automation schedules that
// page still owns.
function AiAssistantSection({
  ai,
  saving,
  locked,
  onPatch,
}: {
  ai: AiAssistantConfig
  saving: boolean
  locked: boolean
  onPatch: (next: Partial<AiAssistantConfig>) => void
}) {
  const { t } = useI18n()
  // Text fields (name, persona, model, base URL) use a local draft + Save button; the
  // provider dropdown and the toggles auto-save on change, matching the rest of the page.
  const [name, setName] = useState(ai.name)
  const [persona, setPersona] = useState(ai.persona)
  const [model, setModel] = useState(ai.model)
  const [baseURL, setBaseURL] = useState(ai.baseURL)
  const textDirty =
    name.trim() !== ai.name.trim() ||
    persona !== ai.persona ||
    model.trim() !== ai.model.trim() ||
    baseURL.trim() !== ai.baseURL.trim()

  // Switching provider resets the model to that provider's default and clears the
  // base URL for non-custom providers (auto-saved immediately).
  function changeProvider(p: ChatProvider) {
    if (locked) return
    const nextModel = DEFAULT_CHAT_MODEL[p]
    const nextBaseURL = p === 'custom' ? baseURL : ''
    setModel(nextModel)
    setBaseURL(nextBaseURL)
    onPatch({ chatProvider: p, model: nextModel, baseURL: nextBaseURL })
  }

  return (
    <Section title={t('aiAssistant.section.title')}>
      <div className="mb-2 flex items-center justify-end gap-2">
        <PillToggle
          checked={ai.enabled}
          disabled={saving || locked}
          label={t('aiAssistant.enable')}
          onChange={(next) => onPatch({ enabled: next })}
        />
      </div>
      <p className="mb-3 text-xs text-gray-500">{t('aiAssistant.section.desc')}</p>
      {locked && (
        <p className="mb-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
          Docmee is hidden for your user account, so Docmee settings are locked.
        </p>
      )}

      <div
        aria-disabled={locked}
        className={`space-y-4 rounded-lg border p-3 ${
          locked
            ? 'border-gray-200 bg-gray-50 opacity-60 dark:border-gray-800 dark:bg-gray-900/60'
            : ai.enabled
            ? 'border-gray-200 dark:border-gray-800'
            : 'border-gray-200 opacity-70 dark:border-gray-800'
        }`}
      >
        {/* Provider */}
        <label className="block text-xs font-medium text-gray-500">
          {t('aiAssistant.provider.label')}
          <select
            value={ai.chatProvider}
            disabled={saving || locked}
            onChange={(e) => changeProvider(e.target.value as ChatProvider)}
            className={`${field} mt-1`}
          >
            {CHAT_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} — {p.hint}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] font-normal text-gray-400">
            {t('aiAssistant.provider.hint')}
          </span>
        </label>

        {/* Model */}
        <label className="block text-xs font-medium text-gray-500">
          {t('aiAssistant.model.label')}
          <input
            type="text"
            list="jzel-model-list"
            value={model}
            disabled={locked}
            onChange={(e) => setModel(e.target.value)}
            placeholder={DEFAULT_CHAT_MODEL[ai.chatProvider] || 'model id'}
            className={`${field} mt-1`}
          />
          <datalist id="jzel-model-list">
            {MODEL_SUGGESTIONS[ai.chatProvider].map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <span className="mt-1 block text-[11px] font-normal text-gray-400">
            {t('aiAssistant.model.hint')}
          </span>
        </label>

        {/* Base URL — custom / OpenAI-compatible only */}
        {ai.chatProvider === 'custom' && (
          <label className="block text-xs font-medium text-gray-500">
            {t('aiAssistant.baseURL.label')}
            <input
              type="url"
              value={baseURL}
              disabled={locked}
              onChange={(e) => setBaseURL(e.target.value)}
              placeholder={t('aiAssistant.baseURL.placeholder')}
              className={`${field} mt-1`}
            />
            <span className="mt-1 block text-[11px] font-normal text-gray-400">
              {t('aiAssistant.baseURL.hint')}
            </span>
          </label>
        )}

        {/* Intent provider — patient-message routing (DeepSeek by default) */}
        <label className="block text-xs font-medium text-gray-500">
          {t('aiAssistant.intent.label')}
          <select
            value={ai.intentProvider}
            disabled={saving || locked}
            onChange={(e) => onPatch({ intentProvider: e.target.value as IntentProvider })}
            className={`${field} mt-1`}
          >
            {INTENT_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} — {p.hint}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] font-normal text-gray-400">
            {t('aiAssistant.intent.hint')}
          </span>
        </label>

        {/* KB embedding provider — switching requires a KB re-index */}
        <label className="block text-xs font-medium text-gray-500">
          {t('aiAssistant.embed.label')}
          <select
            value={ai.embedProvider}
            disabled={saving || locked}
            onChange={(e) => onPatch({ embedProvider: e.target.value as EmbedProvider })}
            className={`${field} mt-1`}
          >
            {EMBED_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} — {p.hint}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] font-normal text-amber-600 dark:text-amber-400">
            {t('aiAssistant.embed.hint')}
          </span>
        </label>

        {/* Name */}
        <label className="block text-xs font-medium text-gray-500">
          {t('aiAssistant.name.label')}
          <input
            type="text"
            value={name}
            disabled={locked}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('aiAssistant.name.placeholder')}
            className={`${field} mt-1`}
          />
        </label>

        {/* Persona */}
        <label className="block text-xs font-medium text-gray-500">
          {t('aiAssistant.persona.label')}
          <textarea
            value={persona}
            disabled={locked}
            onChange={(e) => setPersona(e.target.value)}
            placeholder={t('aiAssistant.persona.placeholder')}
            rows={4}
            className={`${field} mt-1 resize-y`}
          />
          <span className="mt-1 block text-[11px] font-normal text-gray-400">
            {t('aiAssistant.persona.hint')}
          </span>
        </label>

        <div className="flex justify-end">
          <button
            type="button"
            disabled={!textDirty || saving || locked}
            onClick={() => onPatch({ name: name.trim() || 'Docmee', persona, model: model.trim(), baseURL: baseURL.trim() })}
            className="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-cyan-700 disabled:opacity-50"
          >
            {t('common.save')}
          </button>
        </div>

        {/* Knowledge sources */}
        <div>
          <p className="text-xs font-medium text-gray-500">{t('aiAssistant.sources.label')}</p>
          <div className="mt-2 space-y-2">
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>{t('aiAssistant.sources.kb')}</span>
              <PillToggle
                checked={ai.useKb}
                disabled={saving || locked}
                label={t('aiAssistant.sources.kb')}
                onChange={(next) => onPatch({ useKb: next })}
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>{t('aiAssistant.sources.help')}</span>
              <PillToggle
                checked={ai.useHelp}
                disabled={saving || locked}
                label={t('aiAssistant.sources.help')}
                onChange={(next) => onPatch({ useHelp: next })}
              />
            </label>
          </div>
          <p className="mt-1.5 text-[11px] text-gray-400">{t('aiAssistant.sources.hint')}</p>
        </div>
      </div>
    </Section>
  )
}

// Thin data-wiring wrapper: derives ai/locked from the clinic + auth store and
// owns the save mutation, same pattern as BotToneLanguageSection above.
function AiAssistantConfigSection({ clinic }: { clinic: Clinic }) {
  const qc = useQueryClient()
  const jzelConfigLocked = useAuthStore((s) => s.user?.jzelEnabled === false)
  const settings = clinic.settings as ClinicSettings
  const ai = readAiAssistant(settings)

  const save = useMutation({
    mutationFn: (next: Partial<AiAssistantConfig>) =>
      api.patch(`/clinics/${clinic.id}`, { settings: { ...clinic.settings, aiAssistant: { ...ai, ...next } } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clinic', clinic.id] })
      qc.invalidateQueries({ queryKey: ['clinics'] })
    },
  })

  function patchAiAssistant(next: Partial<AiAssistantConfig>) {
    if (jzelConfigLocked) return
    save.mutate(next)
  }

  return <AiAssistantSection ai={ai} saving={save.isPending} locked={jzelConfigLocked} onPatch={patchAiAssistant} />
}

export default function AiSettingsPage() {
  const { t } = useI18n()
  const { clinicId, switchClinic } = useActiveClinic()

  const query = useQuery({
    queryKey: ['clinic', clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ clinic: Clinic }>(`/clinics/${clinicId}`),
  })
  const clinic = query.data?.clinic

  return (
    <div className="clinic-page clinic-page-md space-y-6">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{t('nav.aiSettings')}</h1>
          <p className="mt-1 text-sm text-gray-500">{t('aiSettings.desc')}</p>
        </div>
        <ClinicSelect value={clinicId} onChange={switchClinic} label={t('studio.usage.selectClinic')} />
      </div>

      {!clinicId ? (
        <p className="text-sm text-gray-400">{t('studio.kb.selectClinic')}</p>
      ) : query.isLoading ? (
        <p className="text-sm text-gray-400">{t('common.loading')}</p>
      ) : !clinic ? (
        <p className="text-sm text-gray-400">{t('clinic.notFound')}</p>
      ) : (
        <>
          <BotToneLanguageSection clinic={clinic} />
          <AiAssistantConfigSection clinic={clinic} />
          <AiProvidersPanel clinic={clinic} />
        </>
      )}
    </div>
  )
}
