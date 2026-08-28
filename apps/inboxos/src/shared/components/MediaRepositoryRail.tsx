'use client'

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import { useActiveClinic } from '../hooks/useActiveClinic'
import { useAuthStore } from '../store/auth'
import type { MediaAssetSummary } from '../types'
import {
  GOOGLE_DRIVE_MEDIA_TAB,
  MEDIA_REPOSITORY_TABS,
  googleDriveImportPath,
  googleDrivePreviewPath,
  isDriveImagePreviewEligible,
  type MediaRepositoryTab,
} from '../media'

const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 100 * 1024 * 1024

interface GoogleDriveMediaFile {
  id: string
  name: string
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp'
  byteSize: number
  modifiedTime: string | null
  webViewLink: string | null
}

interface GoogleDriveMediaResponse {
  connected: boolean
  authorized: boolean
  reconnectRequired: boolean
  files: GoogleDriveMediaFile[]
  nextPageToken?: string | null
}

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

function DrivePreview({ clinicId, file }: { clinicId: string; file: GoogleDriveMediaFile }) {
  const [url, setUrl] = useState<string | null>(null)
  const eligible = isDriveImagePreviewEligible(file)
  useEffect(() => {
    if (!eligible) return
    let active = true
    let objectUrl: string | null = null
    api.blobUrl(googleDrivePreviewPath(clinicId, file.id)).then((nextUrl) => {
      objectUrl = nextUrl
      if (active) setUrl(nextUrl)
      else URL.revokeObjectURL(nextUrl)
    }).catch(() => undefined)
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [clinicId, eligible, file.id])

  if (file.mimeType === 'application/pdf') {
    return <span aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-red-50 text-[11px] font-bold text-red-700">PDF</span>
  }
  if (url) return <img src={url} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
  return <span aria-hidden className={`grid h-12 w-12 shrink-0 place-items-center rounded-lg ${eligible ? 'animate-pulse bg-gray-200' : 'bg-blue-50 text-blue-700'}`}>{eligible ? '' : 'IMG'}</span>
}

function safeDriveWebLink(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (url.hostname === 'drive.google.com' || url.hostname === 'docs.google.com') ? url.toString() : null
  } catch {
    return null
  }
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
  const [activeTab, setActiveTab] = useState<MediaRepositoryTab>('docmee')
  const [selectedDriveId, setSelectedDriveId] = useState<string | null>(null)
  const [driveSearchInput, setDriveSearchInput] = useState('')
  const [driveQuery, setDriveQuery] = useState('')
  const [drivePageToken, setDrivePageToken] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [deliveryUncertain, setDeliveryUncertain] = useState(false)
  const query = useQuery({
    queryKey: ['media-assets', clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ assets: MediaAssetSummary[]; storageConfigured: boolean }>(`/clinics/${clinicId}/media`),
  })
  const drive = useQuery({
    queryKey: ['google-drive-media', clinicId, driveQuery, drivePageToken],
    enabled: Boolean(clinicId) && activeTab === GOOGLE_DRIVE_MEDIA_TAB,
    queryFn: () => {
      const params = new URLSearchParams()
      if (driveQuery) params.set('query', driveQuery)
      if (drivePageToken) params.set('pageToken', drivePageToken)
      const suffix = params.size > 0 ? `?${params.toString()}` : ''
      return api.get<GoogleDriveMediaResponse>(`/clinics/${encodeURIComponent(clinicId!)}/media/google-drive${suffix}`)
    },
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
  const send = useMutation<{ status?: 'sending' | 'accepted' | 'uncertain'; retryable?: boolean }>({
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
      if (result.status !== 'accepted') {
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
  const importDrive = useMutation<{ asset: MediaAssetSummary }>({
    mutationFn: () => {
      if (!clinicId || !selectedDriveId) throw new Error('Select a Google Drive file')
      return api.post(googleDriveImportPath(clinicId, selectedDriveId))
    },
    onSuccess: ({ asset }) => {
      setLocalError(null)
      setSelectedId(asset.id)
      setSelectedDriveId(null)
      setActiveTab('docmee')
      qc.invalidateQueries({ queryKey: ['media-assets', clinicId] })
    },
    onError: (error) => setLocalError(error instanceof ApiError ? error.message : 'Google Drive import failed'),
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

  function onDriveSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSelectedDriveId(null)
    setDrivePageToken(null)
    setDriveQuery(driveSearchInput.trim())
  }

  const assets = (query.data?.assets ?? []).slice(0, 10)
  return (
    <aside aria-label="Media repository" className="absolute inset-y-0 right-0 z-40 flex w-80 max-w-full flex-col border-l border-[var(--crm-border-color)] bg-[var(--crm-card-bg)] shadow-xl">
      <header className="flex items-center justify-between border-b border-[var(--crm-border-color)] px-3 py-3">
        <div><h2 className="text-sm font-bold">Media repository</h2><p className="text-[11px] text-[var(--crm-text-muted)]">Up to 10 files · 100 MB total</p></div>
        <button type="button" onClick={onClose} aria-label="Close media repository" className="rounded p-1 hover:bg-[var(--crm-hover-bg)]">✕</button>
      </header>
      <div role="tablist" aria-label="Media sources" className="grid grid-cols-2 gap-1 border-b border-[var(--crm-border-color)] p-2">
        {MEDIA_REPOSITORY_TABS.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} onClick={() => { setActiveTab(tab.id); setLocalError(null) }} className={`rounded-lg px-2 py-2 text-xs font-semibold ${activeTab === tab.id ? 'bg-[var(--crm-primary-color)] text-white' : 'hover:bg-[var(--crm-hover-bg)]'}`}>{tab.label}</button>)}
      </div>
      {activeTab === 'docmee' ? <div className="border-b border-[var(--crm-border-color)] p-3">
          <input ref={fileRef} type="file" className="hidden" accept={ACCEPTED_TYPES.join(',')} onChange={onUpload} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={upload.isPending || query.data?.storageConfigured === false} className="w-full rounded-lg border border-[var(--crm-border-color)] px-3 py-2 text-xs font-semibold disabled:opacity-50">
            {upload.isPending ? 'Uploading…' : 'Upload file'}
          </button>
        </div> : <form onSubmit={onDriveSearch} className="flex gap-2 border-b border-[var(--crm-border-color)] p-3">
          <label className="sr-only" htmlFor="drive-media-search">Search Google Drive</label>
          <input id="drive-media-search" value={driveSearchInput} onChange={(event) => setDriveSearchInput(event.target.value)} placeholder="Search PDFs and images" className="min-w-0 flex-1 rounded-lg border border-[var(--crm-border-color)] bg-transparent px-3 py-2 text-xs" />
          <button type="submit" className="rounded-lg border border-[var(--crm-border-color)] px-3 py-2 text-xs font-semibold">Search</button>
        </form>}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {activeTab === 'docmee' ? (query.isLoading ? <p role="status" className="text-xs text-[var(--crm-text-muted)]">Loading media…</p>
          : query.isError ? <p role="alert" className="text-xs text-red-600">Media could not be loaded. Try again.</p>
            : query.data?.storageConfigured === false ? <p role="alert" className="text-xs text-amber-700">Private media storage is not configured for this clinic.</p>
              : assets.length === 0 ? <p className="text-xs text-[var(--crm-text-muted)]">No saved media yet. Upload a clinic-approved file to begin.</p>
                : <ul className="space-y-2">{assets.map((asset) => <li key={asset.id} className={`rounded-lg border p-2 ${selectedId === asset.id ? 'border-[var(--crm-primary-color)]' : 'border-[var(--crm-border-color)]'}`}>
                  <button type="button" onClick={() => setSelectedId(asset.id)} aria-pressed={selectedId === asset.id} className="flex w-full items-center gap-2 text-left">
                    <AssetPreview clinicId={clinicId!} asset={asset} />
                    <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{asset.filename}</span><span className="text-[10px] text-[var(--crm-text-muted)]">{Math.max(1, Math.ceil(asset.byteSize / 1024))} KB</span></span>
                  </button>
                  {(role === 'clinic_admin' || role === 'ia_studio_admin') && <button type="button" onClick={() => remove.mutate(asset.id)} disabled={remove.isPending} className="mt-1 text-[10px] text-red-600">Delete</button>}
                </li>)}</ul>) : drive.isLoading ? <p role="status" className="text-xs text-[var(--crm-text-muted)]">Loading Google Drive…</p>
          : drive.isError ? <p role="alert" className="text-xs text-red-600">Google Drive could not be loaded. Try again.</p>
            : !drive.data?.connected ? <div className="space-y-2 text-xs"><p>Google Drive is not connected for this clinic.</p><p className="text-[var(--crm-text-muted)]">Ask a clinic administrator to connect Google in Studio.</p><a href="/studio/channels" className="inline-block font-semibold text-[var(--crm-primary-color)]">Open Studio integrations</a></div>
              : drive.data.reconnectRequired || !drive.data.authorized ? <div className="space-y-2 text-xs"><p>Google Drive needs a one-time permission refresh.</p><p className="text-[var(--crm-text-muted)]">Existing Calendar access remains active. Ask an administrator to reconnect Google to add read-only Drive access.</p><a href="/studio/channels" className="inline-block font-semibold text-[var(--crm-primary-color)]">Open Studio integrations</a></div>
                : drive.data.files.length === 0 ? <p className="text-xs text-[var(--crm-text-muted)]">No matching PDFs or images were found in Google Drive.</p>
                  : <><ul className="space-y-2">{drive.data.files.map((file) => {
                    const webLink = safeDriveWebLink(file.webViewLink)
                    return <li key={file.id} className={`rounded-lg border p-2 ${selectedDriveId === file.id ? 'border-[var(--crm-primary-color)]' : 'border-[var(--crm-border-color)]'}`}>
                      <button type="button" onClick={() => setSelectedDriveId(file.id)} aria-pressed={selectedDriveId === file.id} className="flex w-full items-center gap-2 text-left">
                        <DrivePreview clinicId={clinicId!} file={file} />
                        <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{file.name}</span><span className="text-[10px] text-[var(--crm-text-muted)]">{Math.max(1, Math.ceil(file.byteSize / 1024))} KB</span></span>
                      </button>
                      {webLink && <a href={webLink} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[10px] text-[var(--crm-primary-color)]">Preview in Google Drive</a>}
                    </li>
                  })}</ul>{drive.data.nextPageToken && <button type="button" onClick={() => { setSelectedDriveId(null); setDrivePageToken(drive.data!.nextPageToken ?? null) }} className="mt-3 w-full rounded-lg border border-[var(--crm-border-color)] px-3 py-2 text-xs font-semibold">Next results</button>}</>}
        {(localError || send.isError) && <p role="alert" className="mt-2 text-xs text-red-600">{localError ?? (send.error instanceof ApiError ? send.error.message : 'Media send failed')}</p>}
      </div>
      <footer className="border-t border-[var(--crm-border-color)] p-3">
        {activeTab === GOOGLE_DRIVE_MEDIA_TAB ? <button type="button" onClick={() => importDrive.mutate()} disabled={!selectedDriveId || importDrive.isPending || !drive.data?.authorized} className="w-full rounded-lg bg-[var(--crm-primary-color)] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
            {importDrive.isPending ? 'Importing securely…' : 'Import selected to Docmee'}
          </button> : <button type="button" onClick={() => send.mutate()} disabled={!selectedId || send.isPending || deliveryUncertain} className="w-full rounded-lg bg-[var(--crm-primary-color)] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
            {deliveryUncertain ? 'Reconciliation required' : send.isPending ? 'Sending…' : 'Send selected media'}
          </button>}
      </footer>
    </aside>
  )
}
