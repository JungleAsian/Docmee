'use client'

// Help Center category page — a breadcrumb back to the help home, the category
// header, and the list of articles within it.
import Link from 'next/link'
import { notFound, useParams } from 'next/navigation'
import { useI18n } from '@/shared/hooks/useI18n'
import { HelpIcon } from '@/shared/components/HelpIcon'
import { HELP_UI, L, getCategory, getArticleTarget } from '@/shared/help/content'

export default function HelpCategoryPage() {
  const { language } = useI18n()
  const params = useParams<{ category: string }>()
  const category = getCategory(params.category)

  if (!category) {
    notFound()
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <nav className="mb-6 text-sm text-gray-500">
          <Link href="/help" className="text-teal-600 hover:underline">
            {L(HELP_UI.backToHelp, language)}
          </Link>
          <span className="mx-1.5">/</span>
          <span>{L(category.title, language)}</span>
        </nav>

        <div className="flex items-start gap-3">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-600 dark:bg-teal-500/10">
            <HelpIcon name={category.icon} className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{L(category.title, language)}</h1>
            <p className="mt-1 text-sm text-gray-500">{L(category.description, language)}</p>
          </div>
        </div>

        <h2 className="mb-3 mt-8 text-xs font-semibold uppercase tracking-wide text-gray-400">
          {L(HELP_UI.inThisCategory, language)}
        </h2>
        <ul className="grid gap-3 lg:grid-cols-2">
          {category.articles.map((article) => (
            <li key={article.slug}>
              <Link
                href={`/help/${category.slug}/${article.slug}`}
                className="docmee-help-list-link flex items-center justify-between gap-3 rounded-lg border p-4 transition"
              >
                <span>
                  <span className="block font-medium text-gray-900 dark:text-gray-100">
                    {L(article.title, language)}
                  </span>
                  <span className="mt-0.5 block text-sm text-gray-500">{L(article.excerpt, language)}</span>
                  {getArticleTarget(category.slug, article.slug) ? (
                    <span className="mt-2 block text-xs font-medium text-teal-700 dark:text-teal-300">
                      {L(getArticleTarget(category.slug, article.slug)!.label, language)}
                    </span>
                  ) : null}
                </span>
                <span aria-hidden="true" className="shrink-0 text-gray-300">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
