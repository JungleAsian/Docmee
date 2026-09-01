'use client'

// Help Center landing — BotPenguin-style hero + search, popular articles and a
// category grid. Search filters the in-memory knowledge base client-side and
// swaps the body for a results list. All copy is bilingual via the help module.
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useI18n } from '@/shared/hooks/useI18n'
import { NavIcon } from '@/shared/components/NavIcon'
import { HelpIcon } from '@/shared/components/HelpIcon'
import {
  HELP_CATEGORIES,
  HELP_UI,
  L,
  POPULAR_ARTICLES,
  getArticle,
  getArticleTarget,
  searchArticles,
} from '@/shared/help/content'

export default function HelpHomePage() {
  const { language } = useI18n()
  const [query, setQuery] = useState('')

  const results = useMemo(() => searchArticles(query), [query])
  const searching = query.trim().length > 0

  const popular = POPULAR_ARTICLES.map((p) => getArticle(p.category, p.article)).filter(
    (x): x is NonNullable<typeof x> => Boolean(x),
  )

  return (
    <div className="h-full overflow-y-auto">
      {/* Hero */}
      <div className="docmee-help-hero px-4 py-12 text-white">
        <div className="docmee-help-hero-inner mx-auto w-full max-w-none">
          <div className="docmee-help-hero-copy">
            <p className="docmee-help-eyebrow">Docmee Support</p>
            <h1 className="text-2xl font-bold sm:text-3xl">{L(HELP_UI.title, language)}</h1>
            <p className="mt-2 max-w-xl text-white/82">{L(HELP_UI.subtitle, language)}</p>
          </div>
          <div className="docmee-help-search mt-6 flex max-w-xl items-center gap-2 rounded-lg px-4 py-3 shadow-lg">
            <span className="shrink-0 text-white/70">
              <NavIcon name="search" className="h-5 w-5" />
            </span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={L(HELP_UI.searchPlaceholder, language)}
              aria-label={L(HELP_UI.searchPlaceholder, language)}
              className="w-full bg-transparent text-white placeholder:text-white/60 focus:outline-none"
            />
            {searching && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="shrink-0 text-sm font-medium text-cyan-200 hover:text-white"
              >
                {L(HELP_UI.clearSearch, language)}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-none px-4 py-8 sm:px-6 lg:px-8">
        {searching ? (
          <section aria-live="polite">
            <h2 className="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
              {L(HELP_UI.searchResults, language)}
            </h2>
            <p className="mb-4 text-sm text-gray-500">
              {L(HELP_UI.resultsFor, language)} “{query}” — {results.length}
            </p>
            {results.length === 0 ? (
              <p className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700">
                {L(HELP_UI.noResults, language)}
              </p>
            ) : (
              <ul className="space-y-2">
                {results.map(({ category, article }) => (
                  <li key={`${category.slug}/${article.slug}`}>
                    <Link prefetch={false}
                      href={`/help/${category.slug}/${article.slug}`}
                    className="docmee-help-list-link block rounded-lg border p-4 transition"
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-600">
                      {L(category.title, language)}
                    </p>
                    <p className="font-medium text-gray-900 dark:text-gray-100">{L(article.title, language)}</p>
                    <p className="mt-0.5 text-sm text-gray-500">{L(article.excerpt, language)}</p>
                    {getArticleTarget(category.slug, article.slug) ? (
                      <p className="mt-3 text-xs font-medium text-teal-700 dark:text-teal-300">
                        {L(getArticleTarget(category.slug, article.slug)!.label, language)}
                      </p>
                    ) : null}
                  </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : (
          <>
            {/* Popular articles */}
            <section className="mb-10">
              <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
                {L(HELP_UI.popular, language)}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {popular.map(({ category, article }) => (
                  <Link prefetch={false}
                    key={`${category.slug}/${article.slug}`}
                    href={`/help/${category.slug}/${article.slug}`}
                    className="docmee-help-list-link flex items-start gap-3 rounded-lg border p-4 transition"
                  >
                    <span className="mt-0.5 shrink-0 text-teal-600">
                      <HelpIcon name={category.icon} />
                    </span>
                    <span>
                      <span className="block font-medium text-gray-900 dark:text-gray-100">
                        {L(article.title, language)}
                      </span>
                      <span className="mt-0.5 block text-sm text-gray-500">{L(article.excerpt, language)}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </section>

            {/* Category grid */}
            <section>
              <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
                {L(HELP_UI.browse, language)}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {HELP_CATEGORIES.map((category) => (
                  <Link prefetch={false}
                    key={category.slug}
                    href={`/help/${category.slug}`}
                    className="docmee-help-category-card rounded-xl border p-5 transition"
                  >
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50 text-teal-600 dark:bg-teal-500/10">
                      <HelpIcon name={category.icon} className="h-5 w-5" />
                    </span>
                    <h3 className="mt-3 font-semibold text-gray-900 dark:text-gray-100">
                      {L(category.title, language)}
                    </h3>
                    <p className="mt-1 text-sm text-gray-500">{L(category.description, language)}</p>
                    <p className="mt-3 text-xs font-medium text-teal-600">
                      {category.articles.length}{' '}
                      {category.articles.length === 1
                        ? L(HELP_UI.articleSingular, language)
                        : L(HELP_UI.articlesCount, language)}
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          </>
        )}

        {/* Contact support */}
        <section className="clinic-card mt-12 p-6 text-center">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">{L(HELP_UI.contactTitle, language)}</h2>
          <p className="mx-auto mt-1 max-w-2xl text-sm text-gray-500">{L(HELP_UI.contactBody, language)}</p>
          <a
            href="mailto:soporte@docmee.ai"
            className="mt-4 inline-block rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-teal-700"
          >
            {L(HELP_UI.contactCta, language)}
          </a>
        </section>
      </div>
    </div>
  )
}
