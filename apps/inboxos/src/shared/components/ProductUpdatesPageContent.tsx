import Link from 'next/link'
import type { ProductFeature, ProductUpdate } from '../productUpdates'
import type { PanelLanguage } from '../types'

export type ProductUpdatesTab = 'updates' | 'features'

const COPY = {
  en: {
    eyebrow: 'DOCMEE PRODUCT GUIDE',
    title: 'Product updates',
    subtitle: 'See what changed and explore the Docmee features available to you.',
    updates: 'What’s New',
    features: 'All Features',
    version: 'Version',
    openFeature: 'Open feature',
  },
  es: {
    eyebrow: 'GUIA DEL PRODUCTO DOCMEE',
    title: 'Novedades del producto',
    subtitle: 'Consulta los cambios y explora las funciones de Docmee disponibles para ti.',
    updates: 'Novedades',
    features: 'Todas las funciones',
    version: 'Version',
    openFeature: 'Abrir funcion',
  },
} as const

interface ProductUpdatesPageContentProps {
  language: PanelLanguage
  activeTab: ProductUpdatesTab
  releases: readonly ProductUpdate[]
  features: readonly ProductFeature[]
  onTabChange: (tab: ProductUpdatesTab) => void
}

export function ProductUpdatesPageContent({
  language,
  activeTab,
  releases,
  features,
  onTabChange,
}: ProductUpdatesPageContentProps) {
  const copy = COPY[language]
  const formatter = new Intl.DateTimeFormat(language === 'es' ? 'es' : 'en', { dateStyle: 'long' })

  return (
    <div className="clinic-page space-y-6">
      <section className="docmee-page-hero">
        <div className="docmee-page-hero-copy">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-cyan-500">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p>{copy.subtitle}</p>
        </div>
      </section>

      <div role="tablist" aria-label={copy.title} className="flex border-b border-slate-700">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'updates'}
          onClick={() => onTabChange('updates')}
          className={`border-b-2 px-4 py-3 text-sm font-semibold ${activeTab === 'updates' ? 'border-cyan-400 text-cyan-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
        >
          {copy.updates}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'features'}
          onClick={() => onTabChange('features')}
          className={`border-b-2 px-4 py-3 text-sm font-semibold ${activeTab === 'features' ? 'border-cyan-400 text-cyan-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
        >
          {copy.features}
        </button>
      </div>

      {activeTab === 'updates' ? (
        <section aria-label={copy.updates} className="space-y-4">
          {releases.map((release) => (
            <article key={release.id} className="border border-slate-700 bg-slate-900/55 p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-100">{release.title[language]}</h2>
                  <time dateTime={release.publishedAt} className="mt-1 block text-xs text-slate-400">
                    {formatter.format(new Date(release.publishedAt))}
                  </time>
                </div>
                {release.version && (
                  <span className="border border-cyan-700 bg-cyan-950/60 px-2 py-1 text-xs font-semibold text-cyan-200">
                    {copy.version} {release.version}
                  </span>
                )}
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-300">{release.summary[language]}</p>
              <ul className="mt-4 space-y-2 text-sm text-slate-200">
                {release.highlights.map((highlight) => (
                  <li key={highlight.en} className="flex gap-2">
                    <span aria-hidden className="text-cyan-400">•</span>
                    <span>{highlight[language]}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>
      ) : (
        <section aria-label={copy.features} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {features.map((feature) => (
            <article key={feature.id} className="flex min-h-48 flex-col border border-slate-700 bg-slate-900/55 p-5 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-400">{feature.category[language]}</p>
              <h2 className="mt-2 text-lg font-semibold text-slate-100">{feature.title[language]}</h2>
              <p className="mt-2 flex-1 text-sm leading-6 text-slate-300">{feature.description[language]}</p>
              <Link href={feature.href} className="mt-4 text-sm font-semibold text-cyan-300 hover:text-cyan-200">
                {copy.openFeature} →
              </Link>
            </article>
          ))}
        </section>
      )}
    </div>
  )
}
