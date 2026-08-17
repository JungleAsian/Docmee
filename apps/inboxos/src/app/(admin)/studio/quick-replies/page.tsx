'use client'

// Screen 4 (Quick replies & templates) — Admin Studio canned in-window replies.
// Pick a clinic, then list / add / edit / delete its quick replies. Secretaries
// insert these into the composer for replies WITHIN the 24h service window (the
// approved WhatsApp templates on the sibling tab are the only way to reach a
// patient outside it). This pass rebuilds the surface to the design map: an
// in-window-vs-template note, a card grid with a clear "In-window only" tag and
// copy/edit/delete actions, search + count, and the loading / error / empty /
// offline states the brief requires.
import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/shared/api/client'
import { QUICK_REPLY_VARS } from '@/shared/templateVars'
import { ClinicSelect } from '@/shared/components/ClinicSelect'
import { StudioMessagingTabs } from '@/shared/components/StudioMessagingTabs'
import { BackButton } from '@/shared/components/BackButton'
import { useI18n } from '@/shared/hooks/useI18n'
import { useActiveClinic } from '@/shared/hooks/useActiveClinic'
import { useOnline } from '@/shared/hooks/useOnline'
import type { QuickReplyTemplate } from '@/shared/types'

export default function QuickRepliesPage() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const online = useOnline()
  const { clinicId, switchClinic } = useActiveClinic()
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [formOpen, setFormOpen] = useState(false)

  const key = ['quick-reply-templates', clinicId]
  const query = useQuery({
    queryKey: key,
    enabled: Boolean(clinicId),
    queryFn: () =>
      api.get<{ templates: QuickReplyTemplate[] }>(`/clinics/${clinicId}/quick-reply-templates`),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del(`/clinics/${clinicId}/quick-reply-templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  })

  const all = query.data?.templates ?? []
  const categories = useMemo(
    () => Array.from(new Set(all.map((tpl) => tpl.category || 'general'))).sort(),
    [all],
  )
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return all.filter((tpl) => {
      const category = tpl.category || 'general'
      if (categoryFilter !== 'all' && category !== categoryFilter) return false
      if (!term) return true
      return `${tpl.title} ${tpl.content} ${category}`.toLowerCase().includes(term)
    })
  }, [all, categoryFilter, search])

  return (
    <div className="clinic-page clinic-page-md space-y-6">
      <StudioMessagingTabs />

      {!online && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm dark:border-amber-900 dark:bg-amber-950/40">
          <p className="font-semibold text-amber-800 dark:text-amber-300">{t('conn.offline.title')}</p>
          <p className="text-xs text-amber-700 dark:text-amber-400">{t('conn.offline.body')}</p>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <BackButton href="/studio" label={t('nav.studio')} />
          <h1 className="text-xl font-bold">{t('studio.quickReplies.title')}</h1>
          <p className="mt-0.5 max-w-2xl text-xs text-gray-500">{t('studio.quickReplies.subhead')}</p>
        </div>
        <div className="flex items-center gap-2">
          <ClinicSelect value={clinicId} onChange={switchClinic} label={t('studio.usage.selectClinic')} />
          {clinicId && (
            <button
              type="button"
              onClick={() => setFormOpen((v) => !v)}
              className="shrink-0 rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700"
            >
              {formOpen ? t('studio.templates.newClose') : `＋ ${t('studio.quickReplies.new')}`}
            </button>
          )}
        </div>
      </div>

      {!clinicId ? (
        <p className="text-sm text-gray-400">{t('studio.quickReplies.selectClinic')}</p>
      ) : (
        <>
          {/* In-window vs. template note (the design's safety framing). */}
          <div className="clinic-card mb-4 flex gap-3 bg-gray-50/60 p-3.5 dark:bg-gray-900/40">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-teal-50 text-base text-teal-700 dark:bg-teal-900/40 dark:text-teal-300" aria-hidden>
              ⚡
            </span>
            <div>
              <p className="text-xs font-bold">{t('studio.quickReplies.noteTitle')}</p>
              <p className="mt-0.5 text-xs text-gray-500">{t('studio.quickReplies.note')}</p>
            </div>
          </div>

          {formOpen && <NewTemplateForm clinicId={clinicId} onCreated={() => setFormOpen(false)} />}

          {/* Search + category filter + count */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 dark:border-gray-700 dark:bg-gray-800">
              <span aria-hidden className="text-gray-400">
                🔍
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('studio.quickReplies.search')}
                className="w-full bg-transparent text-sm outline-none"
              />
            </div>
            {all.length > 0 && (
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                aria-label={t('studio.quickReplies.filterCategory')}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
              >
                <option value="all">{t('studio.quickReplies.allCategories')}</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {formatCategory(category)}
                  </option>
                ))}
              </select>
            )}
            {all.length > 0 && (
              <span className="text-xs text-gray-400">
                {t('studio.quickReplies.count', { n: filtered.length, m: all.length })}
              </span>
            )}
          </div>

          {query.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2" aria-busy="true">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-28 animate-pulse rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900"
                />
              ))}
            </div>
          ) : query.isError ? (
            <ErrorState onRetry={() => query.refetch()} />
          ) : all.length === 0 ? (
            <EmptyState
              icon="⚡"
              title={t('studio.quickReplies.empty')}
              hint={t('studio.quickReplies.subhead')}
              action={
                <button
                  type="button"
                  onClick={() => setFormOpen(true)}
                  className="mt-3 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700"
                >
                  ＋ {t('studio.quickReplies.new')}
                </button>
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon="🔍"
              title={t('studio.quickReplies.emptyFilter')}
              action={
                <button
                  type="button"
                  onClick={() => {
                    setSearch('')
                    setCategoryFilter('all')
                  }}
                  className="mt-3 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                >
                  {t('conv.clearFilters')}
                </button>
              }
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {filtered.map((tpl) => (
                <QuickReplyCard
                  key={tpl.id}
                  clinicId={clinicId}
                  template={tpl}
                  onDelete={() => {
                    if (confirm(t('studio.quickReplies.deleteConfirm'))) deleteMutation.mutate(tpl.id)
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Card (view + inline edit) ──────────────────────────────────────────────────
function formatCategory(category: string) {
  return category.replace(/[-_]+/g, ' ').replace(/[A-Za-z]/, (char) => char.toUpperCase())
}

function QuickReplyCard({
  clinicId,
  template,
  onDelete,
}: {
  clinicId: string
  template: QuickReplyTemplate
  onDelete: () => void
}) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [title, setTitle] = useState(template.title)
  const [content, setContent] = useState(template.content)
  const [category, setCategory] = useState(template.category || 'general')

  const updateMutation = useMutation({
    mutationFn: () =>
      api.patch(`/clinics/${clinicId}/quick-reply-templates/${template.id}`, { title, content, category }),
    onSuccess: () => {
      setEditing(false)
      qc.invalidateQueries({ queryKey: ['quick-reply-templates', clinicId] })
    },
  })

  function startEdit() {
    setTitle(template.title)
    setContent(template.content)
    setCategory(template.category || 'general')
    setEditing(true)
  }

  function copy() {
    void navigator.clipboard?.writeText(template.content)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  if (editing) {
    return (
      <div className="space-y-2 rounded-xl border border-teal-200 bg-white p-3.5 dark:border-teal-900 dark:bg-gray-900">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('studio.quickReplies.titleField')}
          className="w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
        />
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder={t('studio.quickReplies.category')}
          className="w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
          placeholder={t('studio.quickReplies.content')}
          className="w-full resize-none rounded-lg border border-gray-300 px-2.5 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
        />
        <div className="flex gap-2">
          <button
            type="button"
            disabled={updateMutation.isPending || !title.trim() || !content.trim() || !category.trim()}
            onClick={() => {
              if (title.trim() && content.trim() && category.trim()) updateMutation.mutate()
            }}
            className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
          >
            {t('common.save')}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="clinic-card flex flex-col gap-2 p-3.5">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 font-semibold">{template.title}</p>
        <span className="shrink-0 rounded-md bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-700 dark:bg-teal-950/50 dark:text-teal-300">
          {formatCategory(template.category || 'general')}
        </span>
      </div>
      <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-500">
        {template.content}
      </p>
      <div className="mt-auto flex items-center gap-2 pt-1">
        <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500 dark:bg-gray-800">
          {t('studio.quickReplies.inWindowTag')}
        </span>
        <div className="ml-auto flex gap-1.5">
          <button
            type="button"
            onClick={copy}
            className="rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {copied ? `✓ ${t('studio.quickReplies.copied')}` : `⧉ ${t('studio.quickReplies.copy')}`}
          </button>
          <button
            type="button"
            onClick={startEdit}
            className="rounded-md border border-gray-300 px-2 py-1 text-[11px] hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            ✎ {t('common.edit')}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md border border-red-200 px-2 py-1 text-[11px] text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
          >
            {t('common.delete')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── New quick reply ────────────────────────────────────────────────────────────
function NewTemplateForm({ clinicId, onCreated }: { clinicId: string; onCreated: () => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('general')
  const [content, setContent] = useState('')

  const mutation = useMutation({
    mutationFn: () => api.post(`/clinics/${clinicId}/quick-reply-templates`, { title, content, category }),
    onSuccess: () => {
      setTitle('')
      setCategory('general')
      setContent('')
      qc.invalidateQueries({ queryKey: ['quick-reply-templates', clinicId] })
      onCreated()
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (title.trim() && content.trim() && category.trim()) mutation.mutate()
  }

  return (
    <form
      onSubmit={onSubmit}
      className="clinic-card mb-5 space-y-2 p-4"
    >
      <h3 className="text-sm font-bold">{t('studio.quickReplies.new')}</h3>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('studio.quickReplies.titleField')}
        className="w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
      />
      <input
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        placeholder={t('studio.quickReplies.category')}
        className="w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={3}
        placeholder={t('studio.quickReplies.content')}
        className="w-full resize-none rounded-lg border border-gray-300 px-2.5 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
      />
      {mutation.isError && (
        <p role="alert" className="text-xs text-red-600">
          {mutation.error instanceof ApiError ? mutation.error.message : t('common.error')}
        </p>
      )}
      <p className="text-[11px] text-gray-400">
        {t('studio.quickReplies.vars')} {QUICK_REPLY_VARS.map((v) => `{{${v}}}`).join(' ')}
      </p>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={mutation.isPending || !title.trim() || !content.trim() || !category.trim()}
          className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
        >
          {t('studio.quickReplies.add')}
        </button>
        <button
          type="button"
          onClick={onCreated}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}

// ── Shared states ──────────────────────────────────────────────────────────────
function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n()
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950/40">
      <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full bg-red-100 text-lg text-red-600 dark:bg-red-900/60" aria-hidden>
        ⚠
      </div>
      <p className="text-sm font-semibold text-red-700 dark:text-red-300">{t('common.error')}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/40"
      >
        ↻ {t('common.retry')}
      </button>
    </div>
  )
}

function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: string
  title: string
  hint?: string
  action?: React.ReactNode
}) {
  return (
    <div className="clinic-card p-10 text-center">
      <div className="mx-auto mb-2 grid h-11 w-11 place-items-center rounded-xl bg-gray-100 text-lg text-gray-400 dark:bg-gray-800" aria-hidden>
        {icon}
      </div>
      <p className="text-sm font-semibold">{title}</p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      {action}
    </div>
  )
}
