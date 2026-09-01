'use client'

import Link from 'next/link'
import { useI18n } from '@/shared/hooks/useI18n'
import {
  NO_CODE_BUILDERS,
  VOICE_BOOKING_NO_CODE_STEPS,
  type NoCodeBuilderKind,
} from '@/shared/noCodeBuilders'

type TranslateKey = Parameters<ReturnType<typeof useI18n>['t']>[0]

export function NoCodeBuilderGuide({ active }: { active: NoCodeBuilderKind }) {
  const { t } = useI18n()

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            {t('nocode.eyebrow')}
          </p>
          <h2 className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-50">
            {t('nocode.title')}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-500 dark:text-gray-400">
            {t('nocode.desc')}
          </p>
        </div>
        <Link prefetch={false}
          href="/studio/workflows"
          className="rounded-md border border-emerald-300 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950"
        >
          {t('nocode.voice.openTemplate')}
        </Link>
      </div>

      <div className="mt-4 grid gap-2 lg:grid-cols-3">
        {NO_CODE_BUILDERS.map((builder) => {
          const selected = builder.kind === active
          return (
            <Link prefetch={false}
              key={builder.kind}
              href={builder.href}
              aria-current={selected ? 'page' : undefined}
              className={`rounded-md border p-3 transition ${
                selected
                  ? 'border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/40'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                  {t(builder.titleKey as TranslateKey)}
                </p>
                {selected ? (
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-900 dark:text-sky-200">
                    {t('nocode.current')}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t(builder.descKey as TranslateKey)}
              </p>
              <p className="mt-2 text-[11px] font-medium text-gray-400">
                {t(builder.fitKey as TranslateKey)}
              </p>
            </Link>
          )
        })}
      </div>

      <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
          {t('nocode.voice.title')}
        </p>
        <div className="mt-2 grid gap-2 lg:grid-cols-3">
          {VOICE_BOOKING_NO_CODE_STEPS.map((step, index) => {
            const builder = NO_CODE_BUILDERS.find((item) => item.kind === step.targetKind)
            return (
              <div key={step.labelKey} className="rounded-md bg-white p-3 dark:bg-gray-900">
                <p className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                  {index + 1}. {t(step.labelKey as TranslateKey)}
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t(step.descKey as TranslateKey)}
                </p>
                {builder ? (
                  <Link prefetch={false} href={builder.href} className="mt-2 inline-block text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    {t(builder.titleKey as TranslateKey)}
                  </Link>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
