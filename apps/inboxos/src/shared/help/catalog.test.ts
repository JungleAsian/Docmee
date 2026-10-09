import { describe, expect, it } from 'vitest'
import { getArticle, getArticleTarget, helpAsText, searchArticles, HELP_CATEGORIES, POPULAR_ARTICLES } from './content'
import { buildCatalogHelp } from './catalog'
import { PRODUCT_FEATURES, PRODUCT_UPDATES, type ProductUpdate } from '../productUpdates'

describe('Help product catalog integration', () => {
  it('makes every curated release reachable and searchable in both languages', () => {
    for (const release of PRODUCT_UPDATES) {
      expect(getArticle('release-notes', release.id)?.article.title).toEqual(release.title)
      for (const language of ['en', 'es'] as const) {
        expect(searchArticles(release.title[language]).some(hit => hit.article.slug === release.id)).toBe(true)
        expect(helpAsText(language)).toContain(release.summary[language])
      }
      expect(getArticleTarget('release-notes', release.id)?.href).toBe('/updates')
    }
  })

  it('makes every feature reachable with its real application destination', () => {
    for (const feature of PRODUCT_FEATURES) {
      expect(getArticle('all-features', feature.id)?.article.excerpt).toEqual(feature.description)
      expect(getArticleTarget('all-features', feature.id)?.href).toBe(feature.href)
    }
  })

  it('includes a future release without a second hand-maintained Help entry and orders newest first', () => {
    const release: ProductUpdate = {
      id: 'future-release', publishedAt: '2027-01-01T00:00:00.000Z', audience: 'platform',
      title: { en: 'Future release', es: 'Versión futura' },
      summary: { en: 'Future summary', es: 'Resumen futuro' },
      highlights: [{ en: 'Future change', es: 'Cambio futuro' }],
    }
    const result = buildCatalogHelp([...PRODUCT_UPDATES, release], [])
    const article = result.categories.find(category => category.slug === 'release-notes')?.articles[0]
    expect(article?.slug).toBe('future-release')
    expect(article?.body).toContainEqual({ type: 'ul', items: [{ en: 'Future change', es: 'Cambio futuro' }] })
    expect(result.targets['release-notes/future-release']?.href).toBe('/updates')
    expect(article?.body.some(block => block.type === 'note')).toBe(true)
  })

  it('preserves existing Help URLs alongside new guides', () => {
    expect(getArticle('inbox', 'manage-conversations')).toBeDefined()
    expect(getArticle('appointments', 'book-appointment')).toBeDefined()
    expect(getArticle('jzel-ai', 'knowledge-base')).toBeDefined()
    expect(getArticle('new-features', 'scheduled-messages')).toBeDefined()
    expect(getArticleTarget('new-features', 'workflow-diagnostics')?.href).toBe('/studio/workflows')
    expect(getArticleTarget('channels', 'connect-update-whatsapp')?.href).toBe('/studio/channels')
    expect(getArticleTarget('channels', 'channel-troubleshooting')?.href).toBe('/studio/channels')
    expect(getArticleTarget('templates', 'quick-replies')?.href).toBe('/studio/quick-replies')
  })

  it('keeps category and article URLs unique and popular links resolvable', () => {
    expect(new Set(HELP_CATEGORIES.map(category => category.slug)).size).toBe(HELP_CATEGORIES.length)
    for (const category of HELP_CATEGORIES) {
      expect(new Set(category.articles.map(article => article.slug)).size).toBe(category.articles.length)
    }
    for (const link of POPULAR_ARTICLES) expect(getArticle(link.category, link.article)).toBeDefined()
  })
})
