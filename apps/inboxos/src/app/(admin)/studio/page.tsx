'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { useAuthStore } from '@/shared/store/auth'
import { useI18n } from '@/shared/hooks/useI18n'
import { NavIcon } from '@/shared/components/NavIcon'

type Clinic = {
  id: string
  name: string
  settings?: Record<string, unknown> | null
}

type Doctor = {
  id: string
  calendarConnected?: boolean
}

type Service = {
  id: string
}

type KnowledgeDocument = {
  id: string
}

type ChannelAccount = {
  channel: 'whatsapp' | 'messenger' | 'instagram'
  status: 'active' | 'inactive' | 'error'
  provider?: 'meta_whatsapp' | 'twilio_whatsapp' | 'evolution_test'
}

type ClinicLicense = {
  state: 'none' | 'active' | 'expired' | 'invalid'
}

const SECTION_MAP = [
  {
    title: 'Chatbot',
    eyebrow: 'Build and train',
    href: '/studio/custom-flows',
    icon: 'customFlows',
    items: ['Assistant rules', 'Flow canvas', 'Knowledge base', 'Templates'],
  },
  {
    title: 'Agents',
    eyebrow: 'Staff and AI roles',
    href: '/studio/users',
    icon: 'users',
    items: ['Users', 'Role permissions', 'Doctors', 'Escalation ownership'],
  },
  {
    title: 'Inbox',
    eyebrow: 'Conversation operations',
    href: '/inbox',
    icon: 'inbox',
    items: ['Patient queue', 'Tags', 'Assignments', 'Safety handoff'],
  },
  {
    title: 'Analytics',
    eyebrow: 'Performance review',
    href: '/analytics',
    icon: 'analytics',
    items: ['Demand', 'Automation rate', 'Handoffs', 'Knowledge coverage'],
  },
  {
    title: 'More / Admin',
    eyebrow: 'Platform settings',
    href: '/studio/channels',
    icon: 'channels',
    items: ['Channels', 'Integrations', 'Usage', 'License and governance'],
  },
] as const

export default function StudioHomePage() {
  const { t } = useI18n()
  const userClinicId = useAuthStore((state) => state.user?.clinicId)
  const [selectedClinicId, setSelectedClinicId] = useState(userClinicId ?? '')

  const clinicsQuery = useQuery({
    queryKey: ['clinics'],
    queryFn: () => api.get<{ clinics: Clinic[] }>('/clinics'),
  })

  const clinicId = selectedClinicId || clinicsQuery.data?.clinics[0]?.id || ''
  const enabled = Boolean(clinicId)

  const clinicQuery = useQuery({
    queryKey: ['clinic', clinicId],
    enabled,
    queryFn: () => api.get<{ clinic: Clinic }>(`/clinics/${clinicId}`),
  })
  const doctorsQuery = useQuery({
    queryKey: ['doctors', clinicId],
    enabled,
    queryFn: () => api.get<{ doctors: Doctor[] }>(`/clinics/${clinicId}/doctors`),
  })
  const servicesQuery = useQuery({
    queryKey: ['services', clinicId],
    enabled,
    queryFn: () => api.get<{ services: Service[] }>(`/clinics/${clinicId}/services`),
  })
  const kbQuery = useQuery({
    queryKey: ['kb', clinicId],
    enabled,
    queryFn: () => api.get<{ documents: KnowledgeDocument[] }>(`/clinics/${clinicId}/kb`),
  })
  const channelsQuery = useQuery({
    queryKey: ['clinic-channels', clinicId],
    enabled,
    queryFn: () => api.get<{ accounts: ChannelAccount[] }>(`/clinics/${clinicId}/channels`),
  })
  const licenseQuery = useQuery({
    queryKey: ['license', clinicId],
    enabled,
    queryFn: () => api.get<{ license: ClinicLicense }>(`/clinics/${clinicId}/license`),
  })

  const checklist = useMemo(() => {
    const settings = (clinicQuery.data?.clinic.settings ?? {}) as Record<string, unknown>
    const doctors = doctorsQuery.data?.doctors ?? []
    const services = servicesQuery.data?.services ?? []
    const docs = kbQuery.data?.documents ?? []
    const accounts = channelsQuery.data?.accounts ?? []
    const hasProductionWhatsApp = accounts.some(
      (account) =>
        account.channel === 'whatsapp' &&
        account.status === 'active' &&
        account.provider !== 'evolution_test',
    )

    return [
      {
        key: 'bot',
        href: clinicId ? `/studio/clinics/${clinicId}` : '/studio/clinics',
        done: settings['botTone'] !== undefined || Boolean(settings['clinicRules']),
      },
      { key: 'whatsapp', href: '/studio/channels', done: hasProductionWhatsApp },
      { key: 'doctors', href: '/studio/doctors', done: doctors.length > 0 },
      { key: 'services', href: '/studio/doctors', done: services.length > 0 },
      { key: 'calendar', href: '/studio/doctors', done: doctors.some((doctor) => doctor.calendarConnected) },
      { key: 'knowledge', href: '/studio/kb', done: docs.length > 0 },
      { key: 'license', href: '/studio/license', done: licenseQuery.data?.license.state === 'active' },
    ] as const
  }, [
    channelsQuery.data?.accounts,
    clinicId,
    clinicQuery.data?.clinic.settings,
    doctorsQuery.data?.doctors,
    kbQuery.data?.documents,
    licenseQuery.data?.license.state,
    servicesQuery.data?.services,
  ])

  const completed = checklist.filter((step) => step.done).length
  const progress = (completed / checklist.length) * 100
  const loading =
    clinicQuery.isLoading ||
    doctorsQuery.isLoading ||
    servicesQuery.isLoading ||
    kbQuery.isLoading ||
    channelsQuery.isLoading ||
    licenseQuery.isLoading

  return (
    <div className="clinic-surface">
      <div className="clinic-page clinic-page-md space-y-6">
        <div className="clinic-page-header">
          <div>
            <p className="clinic-eyebrow">Admin Studio command center</p>
            <h1 className="clinic-title">{t('setup.title')}</h1>
            <p className="clinic-subtitle">
              A BotPenguin-style map for Docmee: set up the assistant, connect channels, manage staff, watch the inbox, and review analytics from one place.
            </p>
          </div>
          <div className="clinic-toolbar">
            <label className="flex flex-col text-xs font-medium text-gray-500">
              {t('analytics.selectClinic')}
              <select
                value={clinicId}
                onChange={(event) => setSelectedClinicId(event.target.value)}
                className="mt-1 min-w-56 rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
              >
                <option value="">{t('setup.selectClinic')}</option>
                {(clinicsQuery.data?.clinics ?? []).map((clinic) => (
                  <option key={clinic.id} value={clinic.id}>
                    {clinic.name}
                  </option>
                ))}
              </select>
            </label>
            <Link
              href="/studio/clinics"
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              {t('setup.manageClinics')}
            </Link>
          </div>
        </div>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
          <div className="clinic-card p-4 md:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">{t('setup.subtitle')}</h2>
                <p className="mt-1 text-xs text-gray-500">
                  {loading ? t('common.loading') : t('setup.progress', { done: completed, total: checklist.length })}
                </p>
              </div>
              <span className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                {Math.round(progress)}%
              </span>
            </div>
            <div className="mb-3 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {checklist.map((step) => (
                <li key={step.key} className="flex items-center gap-3 py-3">
                  <span
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                      step.done
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                        : 'border border-gray-300 text-gray-400 dark:border-gray-700'
                    }`}
                  >
                    {step.done ? <NavIcon name="check" className="h-4 w-4" /> : ''}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{t(`setup.step.${step.key}.title` as Parameters<typeof t>[0])}</p>
                    <p className="text-xs text-gray-500">{t(`setup.step.${step.key}.desc` as Parameters<typeof t>[0])}</p>
                  </div>
                  <Link
                    href={step.href}
                    className="shrink-0 rounded-md border border-gray-300 px-3 py-1 text-xs font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                  >
                    {step.done ? t('common.edit') : t('setup.go')}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="clinic-card p-4 md:p-5">
            <h2 className="text-sm font-semibold">Operational coverage</h2>
            <p className="mt-1 text-xs text-gray-500">
              Mirrors the BotPenguin areas that matter for a clinic assistant without exposing billing or destructive account actions in the first pass.
            </p>
            <div className="mt-4 grid gap-3">
              {[
                ['Channels', '/studio/channels', 'WhatsApp, Messenger, Instagram'],
                ['App connections', '/studio/integrations', 'n8n, exports, third-party apps'],
                ['Custom settings', '/studio/quick-replies', 'Quick replies, templates, automations'],
                ['Governance', '/studio/governance', 'Consent, audit posture, policy checks'],
                ['Activities', '/studio/activities', 'Change history, credentials, role and clinic edits'],
              ].map(([label, href, detail]) => (
                <Link
                  key={label}
                  href={href}
                  className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800"
                >
                  <span>
                    <span className="block font-medium">{label}</span>
                    <span className="block text-xs text-gray-500">{detail}</span>
                  </span>
                  <span aria-hidden className="text-gray-400">
                    &rarr;
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {SECTION_MAP.map((section) => (
            <Link
              key={section.title}
              href={section.href}
              className="clinic-card flex min-h-64 flex-col p-4 transition hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-md dark:hover:border-teal-900"
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-md bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                  <NavIcon name={section.icon} className="h-5 w-5" />
                </span>
                <span className="text-xs font-semibold text-teal-600 dark:text-teal-300">{section.eyebrow}</span>
              </div>
              <h2 className="text-base font-bold">{section.title}</h2>
              <ul className="mt-4 space-y-2 text-xs text-gray-500">
                {section.items.map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />
                    {item}
                  </li>
                ))}
              </ul>
              <span className="mt-auto pt-5 text-xs font-semibold text-gray-500">Open section &rarr;</span>
            </Link>
          ))}
        </section>
      </div>
    </div>
  )
}
