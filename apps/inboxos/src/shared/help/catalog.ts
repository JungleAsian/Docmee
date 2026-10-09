import type { ProductAudience, ProductFeature, ProductUpdate } from '../productUpdates'
import type { HelpArticleTarget, HelpCategory, Localized } from './content'

const audienceNotes: Record<ProductAudience, Localized> = {
  all: { en: 'Availability depends on your permissions, clinic configuration, and rollout status.', es: 'La disponibilidad depende de tus permisos, la configuración de la clínica y el estado del lanzamiento.' },
  admin: { en: 'Administrative permissions are required. Some actions are reserved for superusers; see the detailed guide.', es: 'Se requieren permisos administrativos. Algunas acciones están reservadas a superusuarios; consulta la guía detallada.' },
  platform: { en: 'Superusers only. Reading this guide does not grant access to the feature.', es: 'Solo para superusuarios. Leer esta guía no concede acceso a la función.' },
}

/** Use the curated, shipped catalog, not raw commits or unfinished work. */
export function buildCatalogHelp(updates: readonly ProductUpdate[], features: readonly ProductFeature[]) {
  const targets: Record<string, HelpArticleTarget> = {}
  const categories: HelpCategory[] = [
    {
      slug: 'release-notes', icon: 'help',
      title: { en: 'What’s new in Docmee', es: 'Novedades de Docmee' },
      description: { en: 'Published changes, availability, and release highlights. New Product Updates appear here automatically when deployed.', es: 'Cambios publicados, disponibilidad y detalles de cada versión. Las nuevas actualizaciones del producto aparecen aquí automáticamente al publicarse.' },
      articles: [...updates].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).map(update => {
        targets[`release-notes/${update.id}`] = { href: '/updates', label: { en: 'Open Product updates', es: 'Abrir Actualizaciones del producto' } }
        const date = update.publishedAt.slice(0, 10)
        return {
          slug: update.id, title: update.title, excerpt: update.summary,
          body: [
            { type: 'p' as const, text: { en: `Published ${date}${update.version ? ` · Version ${update.version}` : ''}`, es: `Publicado ${date}${update.version ? ` · Versión ${update.version}` : ''}` } },
            { type: 'p' as const, text: update.summary },
            { type: 'ul' as const, items: update.highlights },
            { type: 'note' as const, text: audienceNotes[update.audience] },
          ],
        }
      }),
    },
    {
      slug: 'all-features', icon: 'kb',
      title: { en: 'All features', es: 'Todas las funciones' },
      description: { en: 'Explore the feature catalog and open each feature in Docmee. Access depends on your role.', es: 'Explora el catálogo de funciones y abre cada una en Docmee. El acceso depende de tu rol.' },
      articles: features.map(feature => {
        targets[`all-features/${feature.id}`] = { href: feature.href, label: { en: `Open ${feature.title.en}`, es: `Abrir ${feature.title.es}` } }
        return {
          slug: feature.id, title: feature.title, excerpt: feature.description,
          body: [
            { type: 'h' as const, text: feature.category },
            { type: 'p' as const, text: feature.description },
            { type: 'note' as const, text: audienceNotes[feature.audience] },
          ],
        }
      }),
    },
  ]
  return { categories, targets }
}
