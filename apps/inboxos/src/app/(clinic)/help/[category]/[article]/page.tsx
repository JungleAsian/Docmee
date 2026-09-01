'use client'

// Help Center article page — breadcrumb, the article body rendered from safe
// structured blocks, a lightweight "was this helpful?" control, and links to the
// other articles in the same category.
import { useState } from 'react'
import Link from 'next/link'
import { notFound, useParams } from 'next/navigation'
import { useI18n } from '@/shared/hooks/useI18n'
import { HELP_UI, L, getArticle, getArticleTarget, type HelpBlock } from '@/shared/help/content'

function Block({ block, lang }: { block: HelpBlock; lang: 'es' | 'en' }) {
  switch (block.type) {
    case 'h':
      return <h2 className="mt-6 text-lg font-semibold text-gray-900 dark:text-gray-100">{block.text[lang]}</h2>
    case 'p':
      return <p className="mt-3 leading-relaxed text-gray-700 dark:text-gray-300">{block.text[lang]}</p>
    case 'ul':
      return (
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-gray-700 dark:text-gray-300">
          {block.items.map((item, i) => (
            <li key={i}>{item[lang]}</li>
          ))}
        </ul>
      )
    case 'steps':
      return (
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-gray-700 dark:text-gray-300">
          {block.items.map((item, i) => (
            <li key={i}>{item[lang]}</li>
          ))}
        </ol>
      )
    case 'note':
      return (
        <div className="docmee-help-note mt-4 rounded-lg border-l-4 p-3 text-sm">
          {block.text[lang]}
        </div>
      )
    case 'video':
      return (
        <figure className="clinic-card mt-5 overflow-hidden p-0">
          <div className="aspect-video w-full bg-gray-100 dark:bg-gray-900">
            <iframe
              src={block.src[lang]}
              title={block.title[lang]}
              className="h-full w-full"
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
          <figcaption className="border-t border-gray-100 px-4 py-3 text-sm text-gray-500 dark:border-gray-800">
            <span className="font-medium text-gray-700 dark:text-gray-200">{block.title[lang]}</span>
            {block.caption ? <span className="ml-2">{block.caption[lang]}</span> : null}
          </figcaption>
        </figure>
      )
    default:
      return null
  }
}

export default function HelpArticlePage() {
  const { language } = useI18n()
  const params = useParams<{ category: string; article: string }>()
  const [rated, setRated] = useState(false)
  const found = getArticle(params.category, params.article)

  if (!found) {
    notFound()
  }

  const { category, article } = found
  const related = category.articles.filter((a) => a.slug !== article.slug)
  const target = getArticleTarget(category.slug, article.slug)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <nav className="mb-6 text-sm text-gray-500">
          <Link prefetch={false} href="/help" className="text-teal-600 hover:underline">
            {L(HELP_UI.backToHelp, language)}
          </Link>
          <span className="mx-1.5">/</span>
          <Link prefetch={false} href={`/help/${category.slug}`} className="text-teal-600 hover:underline">
            {L(category.title, language)}
          </Link>
        </nav>

        <article className="max-w-5xl">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{L(article.title, language)}</h1>
              <p className="mt-2 text-gray-500 dark:text-gray-400">{L(article.excerpt, language)}</p>
            </div>
            {target ? (
              <Link prefetch={false} href={target.href} className="docmee-help-page-link">
                {L(target.label, language)}
              </Link>
            ) : null}
          </div>
          <div className="mt-4">
            {article.body.map((block, i) => (
              <Block key={i} block={block} lang={language} />
            ))}
          </div>
        </article>

        {/* Was this helpful? */}
        <div className="clinic-card mt-10 p-5 text-center">
          {rated ? (
            <p className="text-sm font-medium text-green-600">{L(HELP_UI.thanks, language)}</p>
          ) : (
            <>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{L(HELP_UI.wasHelpfulTitle, language)}</p>
              <div className="mt-3 flex justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setRated(true)}
                  className="docmee-help-quiet-button"
                >
                  {L(HELP_UI.yes, language)}
                </button>
                <button
                  type="button"
                  onClick={() => setRated(true)}
                  className="docmee-help-quiet-button"
                >
                  {L(HELP_UI.no, language)}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Related */}
        {related.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
              {L(HELP_UI.related, language)}
            </h2>
            <ul className="space-y-2">
              {related.map((a) => (
                <li key={a.slug}>
                  <Link prefetch={false}
                    href={`/help/${category.slug}/${a.slug}`}
                    className="docmee-help-list-link block rounded-lg border p-3 text-sm transition"
                  >
                    <span className="font-medium text-gray-900 dark:text-gray-100">{L(a.title, language)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
