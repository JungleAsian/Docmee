'use client'

// Screen 7 — Knowledge base editor (Admin Studio). Pick a clinic, then create / edit /
// categorise its entries, upload source documents, and watch each entry's TRAINING
// STATE (is it indexed and retrievable by the bot?) and SOURCE CONFIDENCE (how much
// we trust the text given where it came from). Re-index re-embeds the whole clinic KB.
import { useMemo, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, API_BASE } from '@/shared/api/client'
import { authSnapshot } from '@/shared/store/auth'
import { ClinicSelect } from '@/shared/components/ClinicSelect'
import { useI18n } from '@/shared/hooks/useI18n'
import { useActiveClinic } from '@/shared/hooks/useActiveClinic'
import { trainingInfo, sourceInfo, needsReview, type TrainingState } from '@/shared/kbTraining'
import type { TranslationKey } from '@/shared/i18n'
import type { DocumentStatus, DocumentType, Doctor, KnowledgeDocument } from '@/shared/types'

const DOC_TYPES: DocumentType[] = ['faq', 'policy', 'service_info', 'custom']
const DOC_STATUSES: DocumentStatus[] = ['active', 'draft', 'archived']

// Type-safe label maps (t() only accepts known keys, so dynamic lookups go through these).
const TYPE_LABEL: Record<DocumentType, TranslationKey> = {
  faq: 'studio.kb.typeFaq',
  policy: 'studio.kb.typePolicy',
  service_info: 'studio.kb.typeService_info',
  custom: 'studio.kb.typeCustom',
}
const STATUS_LABEL: Record<DocumentStatus, TranslationKey> = {
  active: 'studio.kb.statusActive',
  draft: 'studio.kb.statusDraft',
  archived: 'studio.kb.statusArchived',
}
const STATE_LABEL: Record<TrainingState, TranslationKey> = {
  trained: 'studio.kb.stateTrained',
  training: 'studio.kb.stateTraining',
  queued: 'studio.kb.stateQueued',
  not_indexed: 'studio.kb.stateNotIndexed',
}
const MAX_UPLOAD_FILES = 5
const STATE_CLASS: Record<TrainingState, string> = {
  trained:
    'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  training:
    'border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950 dark:text-teal-300',
  queued:
    'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
  not_indexed:
    'border-gray-300 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400',
}

interface FaqImportRow {
  question: string
  answer: string
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"' && line[i + 1] === '"') {
      cur += '"'
      i += 1
    } else if (ch === '"') {
      quoted = !quoted
    } else if (ch === ',' && !quoted) {
      cells.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur.trim())
  return cells
}

function parseFaqImport(raw: string): FaqImportRow[] {
  const text = raw.trim()
  if (!text) return []
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const csvRows = lines.map(parseCsvLine).filter((cells) => cells.length >= 2)
  if (csvRows.length > 0 && csvRows.length === lines.length) {
    const first = csvRows[0] ?? []
    const hasHeader = /^(question|pregunta|q)$/i.test(first[0] ?? '') && /^(answer|respuesta|a)$/i.test(first[1] ?? '')
    return csvRows
      .slice(hasHeader ? 1 : 0)
      .map(([question, ...answer]) => ({ question: question ?? '', answer: answer.join(', ').trim() }))
      .filter((row) => row.question && row.answer)
  }

  return text
    .split(/\n\s*\n/)
    .map((block) => {
      const question = block.match(/(?:^|\n)\s*(?:q|question|pregunta)\s*:\s*(.+)/i)?.[1]?.trim()
      const answer = block.match(/(?:^|\n)\s*(?:a|answer|respuesta)\s*:\s*([\s\S]+)/i)?.[1]?.trim()
      if (question && answer) return { question, answer }
      const [first, ...rest] = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      return first?.includes('?') && rest.length > 0 ? { question: first, answer: rest.join('\n') } : null
    })
    .filter((row): row is FaqImportRow => Boolean(row?.question && row.answer))
}

function csvEscape(value: string | number | null | undefined): string {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function downloadKbCsv(clinicId: string, documents: KnowledgeDocument[]) {
  const rows = [
    ['title', 'document_type', 'status', 'doctor_id', 'source', 'ocr', 'content'],
    ...documents.map((doc) => [
      doc.title,
      doc.documentType,
      doc.status,
      doc.metadata?.doctorId ?? '',
      doc.metadata?.source ?? '',
      doc.metadata?.ocr === true ? 'yes' : '',
      doc.content,
    ]),
  ]
  const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `knowledge-${clinicId}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

export default function KbPage() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const { clinicId, switchClinic } = useActiveClinic()
  const isSuperuser = authSnapshot().user?.role === 'ia_studio_admin'
  const [reembedDone, setReembedDone] = useState(false)
  const [category, setCategory] = useState<DocumentType | 'all'>('all')
  const [search, setSearch] = useState('')

  const key = ['kb', clinicId]
  const query = useQuery({
    queryKey: key,
    enabled: Boolean(clinicId) && isSuperuser,
    queryFn: () => api.get<{ documents: KnowledgeDocument[] }>(`/clinics/${clinicId}/kb`),
  })

  // Per-doctor FAQs (Req 30): the clinic's doctors populate the scope selectors.
  const doctorsQuery = useQuery({
    queryKey: ['doctors', clinicId],
    enabled: Boolean(clinicId) && isSuperuser,
    queryFn: () => api.get<{ doctors: Doctor[] }>(`/clinics/${clinicId}/doctors`),
  })
  const doctors = doctorsQuery.data?.doctors ?? []

  const reembedMutation = useMutation({
    mutationFn: () => api.post(`/clinics/${clinicId}/kb/reembed`),
    onSuccess: () => {
      setReembedDone(true)
      setTimeout(() => setReembedDone(false), 3000)
    },
  })

  const documents = query.data?.documents ?? []
  const pendingReview = documents.filter((d) => d.status === 'draft').length
  // Active entries whose text came from a scan (OCR) — low confidence, worth a look.
  const lowConfidence = documents.filter(
    (d) => d.status !== 'draft' && needsReview(d),
  ).length
  const visible = useMemo(() => {
    const scoped = category === 'all' ? documents : documents.filter((d) => d.documentType === category)
    const needle = search.trim().toLowerCase()
    if (!needle) return scoped
    return scoped.filter((doc) => `${doc.title} ${doc.content}`.toLowerCase().includes(needle))
  }, [documents, category, search])

  if (!isSuperuser) {
    return (
      <div className="clinic-page clinic-page-md space-y-6">
        <div className="clinic-card p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Limited access</p>
          <h1 className="mt-2 text-xl font-bold">{t('studio.kb.title')}</h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Clinic KB is managed by super users. This area is disabled for clinic admins.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="clinic-page clinic-page-md space-y-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-bold">{t('studio.kb.title')}</h1>
          {clinicId && !query.isLoading && (
            <span className="text-xs text-gray-400">
              {t('studio.kb.docCount', { n: documents.length })}
            </span>
          )}
        </div>
        <ClinicSelect value={clinicId} onChange={switchClinic} label={t('studio.usage.selectClinic')} />
      </div>

      {!clinicId ? (
        <p className="text-sm text-gray-400">{t('studio.kb.selectClinic')}</p>
      ) : query.isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {t('common.error')}{' '}
          <button type="button" onClick={() => query.refetch()} className="font-medium underline">
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => reembedMutation.mutate()}
              disabled={reembedMutation.isPending}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              {t('studio.kb.reembed')}
            </button>
            <button
              type="button"
              onClick={() => downloadKbCsv(clinicId, documents)}
              disabled={documents.length === 0}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              {t('studio.kb.exportCsv')}
            </button>
            {reembedDone && <span className="text-xs text-emerald-600">{t('studio.kb.reembedQueued')}</span>}
            <span
              className="ml-auto cursor-help text-[11px] text-gray-400"
              title={t('studio.kb.confidenceHint')}
            >
              ⓘ {t('studio.kb.confidenceHigh')} · {t('studio.kb.confidenceMedium')} ·{' '}
              {t('studio.kb.confidenceLow')}
            </span>
          </div>

          <div className="mb-4">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search knowledge base"
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
          </div>

          <UploadDocForm clinicId={clinicId} onUploaded={() => qc.invalidateQueries({ queryKey: key })} />

          {pendingReview > 0 && (
            <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              {t('studio.kb.reviewBanner', { n: pendingReview })}
            </div>
          )}
          {lowConfidence > 0 && (
            <div className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {t('studio.kb.reviewBannerLow', { n: lowConfidence })}
            </div>
          )}

          <NewDocForm clinicId={clinicId} doctors={doctors} />

          <BulkFaqImportForm clinicId={clinicId} />

          {/* Categories (Req: document categories) — filter the list by entry type. */}
          <div className="mb-3 flex flex-wrap gap-1.5">
            <CategoryTab active={category === 'all'} onClick={() => setCategory('all')}>
              {t('studio.kb.allCategories')}
            </CategoryTab>
            {DOC_TYPES.map((dt) => (
              <CategoryTab key={dt} active={category === dt} onClick={() => setCategory(dt)}>
                {t(TYPE_LABEL[dt])}
              </CategoryTab>
            ))}
          </div>

          {query.isLoading ? (
            <ul className="space-y-2" aria-busy>
              {[0, 1, 2].map((i) => (
                <li
                  key={i}
                  className="h-20 animate-pulse rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900"
                />
              ))}
            </ul>
          ) : documents.length === 0 ? (
            <p className="text-sm text-gray-400">{t('studio.kb.empty')}</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-gray-400">{t('studio.kb.noneInCategory')}</p>
          ) : (
            <ul className="space-y-2">
              {visible.map((d) => (
                <DocRow key={d.id} doc={d} clinicId={clinicId} doctors={doctors} queryKey={key} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function CategoryTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
        active
          ? 'border-teal-500 bg-teal-50 text-teal-700 dark:border-teal-500 dark:bg-teal-950 dark:text-teal-300'
          : 'border-gray-300 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'
      }`}
    >
      {children}
    </button>
  )
}

// One document — view mode (badges + scope controls) with an inline edit form.
function DocRow({
  doc,
  clinicId,
  doctors,
  queryKey,
}: {
  doc: KnowledgeDocument
  clinicId: string
  doctors: Doctor[]
  queryKey: (string | undefined)[]
}) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const invalidate = () => qc.invalidateQueries({ queryKey })

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/clinics/${clinicId}/kb/${doc.id}`, body),
    onSuccess: invalidate,
  })
  const deleteMutation = useMutation({
    mutationFn: () => api.del(`/clinics/${clinicId}/kb/${doc.id}`),
    onSuccess: invalidate,
  })

  const train = trainingInfo(doc)
  const src = sourceInfo(doc)
  const stateHint =
    train.state === 'trained'
      ? t('studio.kb.stateTrainedHint')
      : train.state === 'training'
        ? t('studio.kb.stateTrainingHint', { n: train.embeddedCount, total: train.chunkCount })
        : train.state === 'queued'
          ? t('studio.kb.stateQueuedHint')
          : t('studio.kb.stateNotIndexedHint')

  if (editing) {
    return (
      <li className="rounded-lg border border-teal-300 bg-white p-3 dark:border-teal-800 dark:bg-gray-900">
        <EditDocForm
          doc={doc}
          saving={patch.isPending}
          error={patch.isError}
          onCancel={() => setEditing(false)}
          onSave={(body) => patch.mutate(body, { onSuccess: () => setEditing(false) })}
        />
      </li>
    )
  }

  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="font-medium">{doc.title}</p>
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-500 dark:bg-gray-800">
            {t(TYPE_LABEL[doc.documentType])}
          </span>
          {/* Source confidence */}
          <ConfidenceBadge source={src.source} confidence={src.confidence} />
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {/* Training state + progress */}
          <span
            className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${STATE_CLASS[train.state]}`}
            title={stateHint}
          >
            {t(STATE_LABEL[train.state])}
            {train.chunkCount > 0 && (
              <span className="opacity-70">
                {train.embeddedCount}/{train.chunkCount}
              </span>
            )}
          </span>
          {train.state === 'training' && (
            <span className="h-1 w-16 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
              <span
                className="block h-full bg-teal-500"
                style={{ width: `${Math.round(train.progress * 100)}%` }}
              />
            </span>
          )}

          {/* Status */}
          <select
            value={doc.status}
            onChange={(e) => patch.mutate({ status: e.target.value as DocumentStatus })}
            disabled={patch.isPending}
            className="rounded border border-gray-300 bg-transparent px-1 py-0.5 text-[10px] text-gray-500 dark:border-gray-700"
          >
            {DOC_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(STATUS_LABEL[s])}
              </option>
            ))}
          </select>

          {/* Per-doctor scope (Req 30) */}
          <select
            value={doc.metadata?.doctorId ?? ''}
            onChange={(e) => patch.mutate({ doctorId: e.target.value || null })}
            disabled={patch.isPending || doctors.length === 0}
            title={t('studio.kb.doctorHint')}
            className="rounded border border-gray-300 bg-transparent px-1 py-0.5 text-[10px] text-gray-500 dark:border-gray-700"
          >
            <option value="">{t('studio.kb.allDoctors')}</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        <p className="mt-1.5 line-clamp-2 whitespace-pre-wrap text-xs text-gray-500">{doc.content}</p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {doc.status === 'draft' && (
          <button
            type="button"
            onClick={() => patch.mutate({ status: 'active' })}
            disabled={patch.isPending}
            className="rounded-md border border-emerald-300 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-900 dark:hover:bg-emerald-950"
          >
            {t('studio.kb.approve')}
          </button>
        )}
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            {t('studio.kb.edit')}
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm(t('studio.kb.deleteConfirm'))) deleteMutation.mutate()
            }}
            className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
          >
            {t('common.delete')}
          </button>
        </div>
      </div>
    </li>
  )
}

function ConfidenceBadge({
  source,
  confidence,
}: {
  source: 'manual' | 'document' | 'ocr'
  confidence: 'high' | 'medium' | 'low'
}) {
  const { t } = useI18n()
  const sourceLabel: Record<typeof source, TranslationKey> = {
    manual: 'studio.kb.sourceManual',
    document: 'studio.kb.sourceDocument',
    ocr: 'studio.kb.sourceOcr',
  }
  const confLabel: Record<typeof confidence, TranslationKey> = {
    high: 'studio.kb.confidenceHigh',
    medium: 'studio.kb.confidenceMedium',
    low: 'studio.kb.confidenceLow',
  }
  const cls =
    confidence === 'high'
      ? 'border-emerald-300 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300'
      : confidence === 'medium'
        ? 'border-amber-300 text-amber-700 dark:border-amber-900 dark:text-amber-300'
        : 'border-red-300 text-red-700 dark:border-red-900 dark:text-red-300'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${cls}`}
      title={`${t(confLabel[confidence])} · ${t('studio.kb.confidenceHint')}`}
    >
      {t(sourceLabel[source])}
    </span>
  )
}

// Inline entry editor — edit an existing document's title / content / category.
function EditDocForm({
  doc,
  saving,
  error,
  onCancel,
  onSave,
}: {
  doc: KnowledgeDocument
  saving: boolean
  error: boolean
  onCancel: () => void
  onSave: (body: Record<string, unknown>) => void
}) {
  const { t } = useI18n()
  const [title, setTitle] = useState(doc.title)
  const [content, setContent] = useState(doc.content)
  const [documentType, setDocumentType] = useState<DocumentType>(doc.documentType)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim() || !content.trim()) return
    const body: Record<string, unknown> = {}
    if (title !== doc.title) body.title = title
    if (content !== doc.content) body.content = content
    if (documentType !== doc.documentType) body.documentType = documentType
    // Nothing changed → just close, don't fire an empty PATCH (the API rejects it).
    if (Object.keys(body).length === 0) return onCancel()
    onSave(body)
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('studio.kb.docTitle')}
          className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
        />
        <select
          value={documentType}
          onChange={(e) => setDocumentType(e.target.value as DocumentType)}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
        >
          {DOC_TYPES.map((dt) => (
            <option key={dt} value={dt}>
              {t(TYPE_LABEL[dt])}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={4}
        placeholder={t('studio.kb.content')}
        className="w-full resize-y rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving || !title.trim() || !content.trim()}
          className="rounded-md bg-teal-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
        >
          {t('studio.kb.save')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          {t('studio.kb.cancel')}
        </button>
        {error && <span className="text-xs text-red-600">{t('studio.kb.saveError')}</span>}
      </div>
    </form>
  )
}

// Gap #33 — document training. Uploads a file (PDF/Word/text/FAQ) which the API
// extracts, chunks and embeds. Uses a raw FormData fetch (the JSON api client can't
// carry multipart) with the bearer token from the auth store.
function UploadDocForm({ clinicId, onUploaded }: { clinicId: string; onUploaded: () => void }) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState(false)

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(e.target.files ?? [])
    if (selectedFiles.length === 0) return
    const files = selectedFiles.slice(0, MAX_UPLOAD_FILES)
    setBusy(true)
    setMessage(null)
    setError(false)
    try {
      let chunks = 0
      for (const file of files) {
      const form = new FormData()
      form.append('file', file)
      const { accessToken } = authSnapshot()
      const res = await fetch(`${API_BASE}/clinics/${clinicId}/kb/upload`, {
        method: 'POST',
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
        body: form,
      })
      if (!res.ok) {
        // Surface the API's real error (e.g. "File too large — the maximum is 50 MB")
        // instead of a generic failure, so an upload that fails is never silent.
        let serverMsg = ''
        try {
          serverMsg = ((await res.json()) as { error?: string }).error ?? ''
        } catch {
          /* non-JSON error body — fall back to the generic message */
        }
        throw new Error(serverMsg || `${t('studio.kb.uploadError')}: ${file.name}`)
      }
      const data = (await res.json()) as { chunks: number }
      chunks += data.chunks
      }
      const success =
        files.length === 1
          ? t('studio.kb.uploadSuccess', { n: chunks })
          : t('studio.kb.uploadBatchSuccess', { files: files.length, n: chunks })
      setMessage(selectedFiles.length > MAX_UPLOAD_FILES ? `${t('studio.kb.uploadMaxFiles')} ${success}` : success)
      onUploaded()
    } catch (err) {
      setError(true)
      setMessage(err instanceof Error && err.message ? err.message : t('studio.kb.uploadError'))
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-gray-300 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
      <label className="cursor-pointer rounded-md bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-700">
        {busy ? t('common.loading') : t('studio.kb.upload')}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.md,.text,.png,.jpg,.jpeg,.webp,.tif,.tiff,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*"
          onChange={onChange}
          disabled={busy}
          className="hidden"
        />
      </label>
      <span className="text-xs text-gray-400">{t('studio.kb.uploadHint')}</span>
      {message && (
        <span className={`text-xs ${error ? 'text-red-600' : 'text-emerald-600'}`}>{message}</span>
      )}
    </div>
  )
}

function NewDocForm({ clinicId, doctors }: { clinicId: string; doctors: Doctor[] }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [documentType, setDocumentType] = useState<DocumentType>('faq')
  const [doctorId, setDoctorId] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/clinics/${clinicId}/kb`, { title, content, documentType, doctorId: doctorId || null }),
    onSuccess: () => {
      setTitle('')
      setContent('')
      setDocumentType('faq')
      setDoctorId('')
      qc.invalidateQueries({ queryKey: ['kb', clinicId] })
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (title.trim() && content.trim()) mutation.mutate()
  }

  return (
    <form
      onSubmit={onSubmit}
      className="clinic-card mb-6 space-y-2 p-3"
    >
      <div className="flex flex-wrap gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('studio.kb.docTitle')}
          className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
        />
        <select
          value={documentType}
          onChange={(e) => setDocumentType(e.target.value as DocumentType)}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
        >
          {DOC_TYPES.map((dt) => (
            <option key={dt} value={dt}>
              {t(TYPE_LABEL[dt])}
            </option>
          ))}
        </select>
        {doctors.length > 0 && (
          <select
            value={doctorId}
            onChange={(e) => setDoctorId(e.target.value)}
            title={t('studio.kb.doctorHint')}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
          >
            <option value="">{t('studio.kb.allDoctors')}</option>
            {doctors.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={3}
        placeholder={t('studio.kb.content')}
        className="w-full resize-none rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
      />
      <button
        type="submit"
        disabled={mutation.isPending || !title.trim() || !content.trim()}
        className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
      >
        {t('studio.kb.add')}
      </button>
    </form>
  )
}

function BulkFaqImportForm({ clinicId }: { clinicId: string }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [raw, setRaw] = useState('')
  const [doneCount, setDoneCount] = useState<number | null>(null)
  const rows = useMemo(() => parseFaqImport(raw), [raw])

  async function loadFaqFile(file: File | undefined) {
    if (!file) return
    setDoneCount(null)
    setRaw(await file.text())
  }

  const mutation = useMutation({
    mutationFn: async () => {
      for (const row of rows) {
        await api.post(`/clinics/${clinicId}/kb`, {
          title: row.question,
          content: row.answer,
          documentType: 'faq',
          status: 'draft',
        })
      }
      return rows.length
    },
    onSuccess: (count) => {
      setDoneCount(count)
      setRaw('')
      qc.invalidateQueries({ queryKey: ['kb', clinicId] })
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setDoneCount(null)
    if (rows.length > 0 && !mutation.isPending) mutation.mutate()
  }

  return (
    <form
      onSubmit={submit}
      className="mb-6 space-y-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/50"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{t('studio.kb.bulkTitle')}</h2>
          <p className="mt-0.5 text-xs text-gray-500">{t('studio.kb.bulkHint')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="cursor-pointer rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
            Upload FAQ CSV
            <input
              type="file"
              accept=".csv,text/csv,.txt,text/plain"
              className="sr-only"
              onChange={(e) => loadFaqFile(e.target.files?.[0])}
            />
          </label>
          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-gray-500 dark:bg-gray-800">
            {t('studio.kb.bulkParsed', { n: rows.length })}
          </span>
        </div>
      </div>
      <textarea
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value)
          setDoneCount(null)
        }}
        rows={5}
        placeholder={t('studio.kb.bulkPlaceholder')}
        className="w-full resize-y rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={mutation.isPending || rows.length === 0}
          className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
        >
          {mutation.isPending ? t('studio.kb.bulkImporting') : t('studio.kb.bulkImport')}
        </button>
        {mutation.isError && <span className="text-xs text-red-600">{t('studio.kb.bulkError')}</span>}
        {doneCount !== null && (
          <span className="text-xs text-emerald-600">{t('studio.kb.bulkSuccess', { n: doneCount })}</span>
        )}
      </div>
    </form>
  )
}
