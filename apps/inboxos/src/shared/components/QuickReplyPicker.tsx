'use client'

// Gap #25 ? quick reply picker shown in the secretary message box. Opens a popover
// listing the clinic's templates; clicking one inserts its content into the
// composer via onPick. Templates are managed in Admin Studio.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { useI18n } from '../hooks/useI18n'
import type { QuickReplyTemplate } from '../types'

const ALL_CATEGORIES = '__all__'

function categoryLabel(category: string) {
  return category.replace(/[-_]+/g, ' ').replace(/[A-Za-z]/, (char) => char.toUpperCase())
}

export function QuickReplyPicker({ onPick }: { onPick: (content: string) => void }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState(ALL_CATEGORIES)
  const clinicId = useAuthStore((s) => s.user?.clinicId)

  const query = useQuery({
    queryKey: ['quick-reply-templates', clinicId],
    enabled: Boolean(clinicId) && open,
    queryFn: () =>
      api.get<{ templates: QuickReplyTemplate[] }>(`/clinics/${clinicId}/quick-reply-templates`),
  })
  const templates = query.data?.templates ?? []
  const categories = useMemo(
    () => Array.from(new Set(templates.map((tpl) => tpl.category || 'general'))).sort(),
    [templates],
  )
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return templates.filter((tpl) => {
      const tplCategory = tpl.category || 'general'
      if (category !== ALL_CATEGORIES && tplCategory !== category) return false
      if (!term) return true
      return `${tpl.title} ${tpl.content} ${tplCategory}`.toLowerCase().includes(term)
    })
  }, [category, search, templates])

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t('quickReply.button')}
        aria-label={t('quickReply.button')}
        className="rounded-md border border-gray-300 px-2 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
      >
        ?
      </button>

      {open && (
        <div className="fixed bottom-24 left-1/2 z-30 max-h-96 w-80 -translate-x-1/2 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2 dark:border-gray-800">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {t('quickReply.title')}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              {t('quickReply.close')}
            </button>
          </div>

          {templates.length > 0 && (
            <div className="space-y-2 border-b border-gray-100 p-3 dark:border-gray-800">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('quickReply.search')}
                className="w-full rounded-md border border-gray-300 bg-transparent px-2.5 py-1.5 text-xs outline-none focus:border-teal-500 dark:border-gray-700"
              />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                aria-label={t('quickReply.category')}
                className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-teal-500 dark:border-gray-700 dark:bg-gray-900"
              >
                <option value={ALL_CATEGORIES}>{t('quickReply.allCategories')}</option>
                {categories.map((item) => (
                  <option key={item} value={item}>
                    {categoryLabel(item)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {query.isLoading ? (
            <p className="p-3 text-xs text-gray-400">{t('common.loading')}</p>
          ) : templates.length === 0 ? (
            <p className="p-3 text-xs text-gray-400">{t('quickReply.empty')}</p>
          ) : filtered.length === 0 ? (
            <p className="p-3 text-xs text-gray-400">{t('quickReply.emptyFilter')}</p>
          ) : (
            <ul>
              {filtered.map((tpl) => (
                <li key={tpl.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(tpl.content)
                      setOpen(false)
                    }}
                    className="block w-full border-b border-gray-100 px-3 py-2 text-left hover:bg-teal-50 dark:border-gray-800 dark:hover:bg-teal-950/40"
                  >
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-xs font-medium">{tpl.title}</p>
                      <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800">
                        {categoryLabel(tpl.category || 'general')}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-gray-500">{tpl.content}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
