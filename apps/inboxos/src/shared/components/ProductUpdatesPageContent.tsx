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
    viewDetails: 'View details',
    hideDetails: 'Hide details',
  },
  es: {
    eyebrow: 'GUIA DEL PRODUCTO DOCMEE',
    title: 'Novedades del producto',
    subtitle: 'Consulta los cambios y explora las funciones de Docmee disponibles para ti.',
    updates: 'Novedades',
    features: 'Todas las funciones',
    version: 'Version',
    openFeature: 'Abrir funcion',
    viewDetails: 'Ver detalles',
    hideDetails: 'Ocultar detalles',
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
        <section aria-label={copy.updates}>
          <ol className="divide-y divide-slate-700 border border-slate-700 bg-slate-900/55">
            {releases.map((release) => (
              <li key={release.id}>
                <article className="grid gap-3 p-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6 sm:p-5">
                  <div className="flex flex-wrap items-center gap-2 sm:block sm:space-y-2">
                    <time dateTime={release.publishedAt} className="block text-sm text-slate-400">
                      {formatter.format(new Date(release.publishedAt))}
                    </time>
                    {release.version && (
                      <span className="inline-block border border-cyan-700 bg-cyan-950/60 px-2 py-1 text-xs font-semibold text-cyan-200">
                        {copy.version} {release.version}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 break-words">
                    <h2 className="text-base font-semibold text-slate-100">{release.title[language]}</h2>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-300">{release.summary[language]}</p>
                    {release.highlights.length > 0 && (
                      <details className="group mt-2">
                        <summary className="w-fit cursor-pointer rounded py-2 text-sm font-semibold text-cyan-300 hover:text-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400">
                          <span className="group-open:hidden">{copy.viewDetails}</span>
                          <span className="hidden group-open:inline">{copy.hideDetails}</span>
                          <span className="sr-only">: {release.title[language]}</span>
                        </summary>
                        <ul className="mt-2 list-disc space-y-2 border-t border-slate-700 py-4 pl-5 text-sm leading-6 text-slate-200 marker:text-cyan-400">
                          {release.highlights.map((highlight) => (
                            <li key={highlight.en}>{highlight[language]}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                </article>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <section aria-label={copy.features}>
          <ul className="divide-y divide-slate-700 border border-slate-700 bg-slate-900/55">
            {features.map((feature) => (
              <li key={feature.id}>
                <article className="grid items-start gap-3 p-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6 sm:p-5 lg:grid-cols-[10rem_minmax(0,1fr)_auto]">
                  <p className="text-xs font-semibold text-cyan-400">{feature.category[language]}</p>
                  <div className="min-w-0 break-words">
                    <h2 className="text-base font-semibold text-slate-100">{feature.title[language]}</h2>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-300">{feature.description[language]}</p>
                  </div>
                  <Link href={feature.href} className="w-fit rounded py-2 text-sm font-semibold text-cyan-300 hover:text-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 sm:col-start-2 lg:col-start-3 lg:py-0">
                    {copy.openFeature}<span className="sr-only">: {feature.title[language]}</span> <span aria-hidden>→</span>
                  </Link>
                </article>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
