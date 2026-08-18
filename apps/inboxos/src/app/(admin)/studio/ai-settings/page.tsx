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
import { useI18n } from '@/shared/hooks/useI18n'
import { useActiveClinic } from '@/shared/hooks/useActiveClinic'
import { tonePreview } from '@/shared/botPreview'
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
          <AiProvidersPanel clinic={clinic} />
        </>
      )}
    </div>
  )
}
