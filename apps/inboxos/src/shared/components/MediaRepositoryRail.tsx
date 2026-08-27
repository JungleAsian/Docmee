'use client'

import { useRef, useState, type ChangeEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import { useActiveClinic } from '../hooks/useActiveClinic'
import { useAuthStore } from '../store/auth'
import type { MediaAssetSummary } from '../types'

const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 100 * 1024 * 1024

function AssetPreview({ clinicId, asset }: { clinicId: string; asset: MediaAssetSummary }) {
  const download = useQuery({
    queryKey: ['media-download', clinicId, asset.id],
    enabled: asset.contentType !== 'application/pdf',
    staleTime: 4 * 60_000,
    queryFn: () => api.get<{ url: string }>(`/clinics/${clinicId}/media/${asset.id}/download`),
  })
  if (asset.contentType === 'application/pdf') {
    return <span aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-red-50 text-xl">PDF</span>
  }
  if (download.data?.url) {
    return <img src={download.data.url} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
  }
  return <span aria-hidden className="h-12 w-12 shrink-0 animate-pulse rounded-lg bg-gray-200" />
}

export function MediaRepositoryRail({
  conversationId,
  caption,
  onSent,
  onClose,
}: {
  conversationId: string
  caption: string
  onSent: () => void
  onClose: () => void
}) {
  const { clinicId } = useActiveClinic()
  const role = useAuthStore((state) => state.user?.role)
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const sendAttemptRef = useRef<{ signature: string; key: string } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [deliveryUncertain, setDeliveryUncertain] = useState(false)
  const query = useQuery({
    queryKey: ['media-assets', clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ assets: MediaAssetSummary[]; storageConfigured: boolean }>(`/clinics/${clinicId}/media`),
  })
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.upload(`/clinics/${clinicId}/media`, form)
    },
    onSuccess: () => {
      setLocalError(null)
      qc.invalidateQueries({ queryKey: ['media-assets', clinicId] })
    },
    onError: (error) => setLocalError(error instanceof ApiError ? error.message : 'Upload failed'),
  })
  const send = useMutation<{ status?: 'accepted' | 'uncertain'; retryable?: boolean }>({
    mutationFn: () => {
      const signature = `${conversationId}:${selectedId ?? ''}:${caption.trim()}`
      if (sendAttemptRef.current?.signature !== signature) {
        sendAttemptRef.current = { signature, key: `media-asset:${conversationId}:${crypto.randomUUID()}` }
      }
      return api.post(`/conversations/${conversationId}/send-media-asset`, {
        assetId: selectedId,
        ...(caption.trim() ? { caption: caption.trim() } : {}),
      }, { headers: { 'Idempotency-Key': sendAttemptRef.current.key } })
    },
    onSuccess: (result) => {
      if (result.status === 'uncertain') {
        setDeliveryUncertain(true)
        setLocalError('Delivery outcome is uncertain. Do not resend; staff reconciliation is required.')
        qc.invalidateQueries({ queryKey: ['messages', conversationId] })
        return
      }
      sendAttemptRef.current = null
      setDeliveryUncertain(false)
      onSent()
      qc.invalidateQueries({ queryKey: ['messages', conversationId] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })
  const remove = useMutation({
    mutationFn: (assetId: string) => api.del(`/clinics/${clinicId}/media/${assetId}`),
    onSuccess: (_data, assetId) => {
      if (selectedId === assetId) setSelectedId(null)
      qc.invalidateQueries({ queryKey: ['media-assets', clinicId] })
    },
  })

  function onUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!ACCEPTED_TYPES.includes(file.type) || file.size > MAX_BYTES) {
      setLocalError('Choose a PDF, JPEG, PNG, or WebP file up to 100 MB.')
      return
    }
    upload.mutate(file)
  }

  const assets = (query.data?.assets ?? []).slice(0, 10)
  return (
    <aside aria-label="Media repository" className="absolute inset-y-0 right-0 z-40 flex w-80 max-w-full flex-col border-l border-[var(--crm-border-color)] bg-[var(--crm-card-bg)] shadow-xl">
      <header className="flex items-center justify-between border-b border-[var(--crm-border-color)] px-3 py-3">
        <div><h2 className="text-sm font-bold">Media repository</h2><p className="text-[11px] text-[var(--crm-text-muted)]">Up to 10 files · 100 MB total</p></div>
        <button type="button" onClick={onClose} aria-label="Close media repository" className="rounded p-1 hover:bg-[var(--crm-hover-bg)]">✕</button>
      </header>
      <div className="border-b border-[var(--crm-border-color)] p-3">
        <input ref={fileRef} type="file" className="hidden" accept={ACCEPTED_TYPES.join(',')} onChange={onUpload} />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={upload.isPending || query.data?.storageConfigured === false} className="w-full rounded-lg border border-[var(--crm-border-color)] px-3 py-2 text-xs font-semibold disabled:opacity-50">
          {upload.isPending ? 'Uploading…' : 'Upload file'}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {query.isLoading ? <p role="status" className="text-xs text-[var(--crm-text-muted)]">Loading media…</p>
          : query.isError ? <p role="alert" className="text-xs text-red-600">Media could not be loaded. Try again.</p>
            : query.data?.storageConfigured === false ? <p role="alert" className="text-xs text-amber-700">Private media storage is not configured for this clinic.</p>
              : assets.length === 0 ? <p className="text-xs text-[var(--crm-text-muted)]">No saved media yet. Upload a clinic-approved file to begin.</p>
                : <ul className="space-y-2">{assets.map((asset) => <li key={asset.id} className={`rounded-lg border p-2 ${selectedId === asset.id ? 'border-[var(--crm-primary-color)]' : 'border-[var(--crm-border-color)]'}`}>
                  <button type="button" onClick={() => setSelectedId(asset.id)} aria-pressed={selectedId === asset.id} className="flex w-full items-center gap-2 text-left">
                    <AssetPreview clinicId={clinicId!} asset={asset} />
                    <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{asset.filename}</span><span className="text-[10px] text-[var(--crm-text-muted)]">{Math.max(1, Math.ceil(asset.byteSize / 1024))} KB</span></span>
                  </button>
                  {(role === 'clinic_admin' || role === 'ia_studio_admin') && <button type="button" onClick={() => remove.mutate(asset.id)} disabled={remove.isPending} className="mt-1 text-[10px] text-red-600">Delete</button>}
                </li>)}</ul>}
        {(localError || send.isError) && <p role="alert" className="mt-2 text-xs text-red-600">{localError ?? (send.error instanceof ApiError ? send.error.message : 'Media send failed')}</p>}
      </div>
      <footer className="border-t border-[var(--crm-border-color)] p-3">
        <button type="button" onClick={() => send.mutate()} disabled={!selectedId || send.isPending || deliveryUncertain} className="w-full rounded-lg bg-[var(--crm-primary-color)] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
          {deliveryUncertain ? 'Reconciliation required' : send.isPending ? 'Sending…' : 'Send selected media'}
        </button>
      </footer>
    </aside>
  )
}
