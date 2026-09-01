'use client'

// Admin Studio — Clinic Management. List every clinic, create new ones, and edit a
// clinic's name / plan / status / timezone inline.
import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/shared/api/client'
import { useI18n } from '@/shared/hooks/useI18n'
import type { Clinic, ClinicPlan, ClinicStatus } from '@/shared/types'

const PLANS: ClinicPlan[] = ['starter', 'pro', 'enterprise']
const STATUSES: ClinicStatus[] = ['active', 'suspended', 'cancelled']

export default function ClinicsPage() {
  const { t } = useI18n()
  // The Management view needs to see cancelled (soft-deleted) clinics too — so
  // an admin can find and reactivate one — unlike every other clinic picker in
  // the app (which reuses useClinics()/ClinicSelect and never offers a deleted
  // clinic). Hidden by default behind a toggle so "Delete" still visibly removes
  // the row, matching what an admin expects from a delete button.
  const { data, isLoading } = useQuery({
    queryKey: ['clinics', 'all'],
    queryFn: () => api.get<{ clinics: Clinic[] }>('/clinics?include_cancelled=true'),
  })
  const allClinics = data?.clinics ?? []
  const [showCancelled, setShowCancelled] = useState(false)
  const cancelledCount = allClinics.filter((c) => c.status === 'cancelled').length
  const clinics = showCancelled ? allClinics : allClinics.filter((c) => c.status !== 'cancelled')
  const [deleteTarget, setDeleteTarget] = useState<Clinic | null>(null)

  return (
    <div className="clinic-page clinic-page-md space-y-6">
      <h1 className="mb-4 text-xl font-bold">{t('studio.clinics.title')}</h1>

      <SignupRequestsPanel />

      <NewClinicForm />

      {cancelledCount > 0 && (
        <button
          type="button"
          onClick={() => setShowCancelled((v) => !v)}
          className="text-xs font-medium text-teal-700 hover:underline dark:text-teal-300"
        >
          {showCancelled
            ? t('studio.clinics.hideCancelled')
            : t('studio.clinics.showCancelled', { n: String(cancelledCount) })}
        </button>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-400">{t('common.loading')}</p>
      ) : clinics.length === 0 ? (
        <p className="text-sm text-gray-400">{t('studio.clinics.empty')}</p>
      ) : (
        <div className="clinic-card overflow-x-auto">
          <table className="min-w-[56rem] w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-gray-900">
              <tr>
                <th className="px-3 py-2">{t('studio.clinics.name')}</th>
                <th className="px-3 py-2">{t('studio.clinics.slug')}</th>
                <th className="px-3 py-2">{t('studio.clinics.plan')}</th>
                <th className="px-3 py-2">{t('studio.clinics.status')}</th>
                <th className="px-3 py-2">{t('studio.clinics.timezone')}</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {clinics.map((c) => (
                <ClinicRow key={c.id} clinic={c} onRequestDelete={setDeleteTarget} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DeleteClinicDialog
        open={Boolean(deleteTarget)}
        clinic={deleteTarget}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  )
}

interface SignupRequest {
  id: string
  clinicName: string
  fullName: string
  email: string
  status: 'pending' | 'approved' | 'rejected'
  reviewedBy: string | null
  reviewedAt: string | null
  createdAt: string
}

function SignupRequestsPanel() {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ['signup-requests'],
    queryFn: () => api.get<{ requests: SignupRequest[] }>('/auth/signup-requests'),
  })
  const pending = (query.data?.requests ?? []).filter((request) => request.status === 'pending')
  const approve = useMutation({
    mutationFn: (id: string) => api.post(`/auth/signup-requests/${id}/approve`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['signup-requests'] })
      qc.invalidateQueries({ queryKey: ['clinics'] })
    },
  })
  const reject = useMutation({
    mutationFn: (id: string) => api.post(`/auth/signup-requests/${id}/reject`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['signup-requests'] }),
  })

  return (
    <section className="clinic-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Signup approvals</h2>
          <p className="text-xs text-gray-500">Approve new clinic admin requests before they can access Docmee.</p>
        </div>
        <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700 dark:bg-teal-950 dark:text-teal-300">
          {pending.length} pending
        </span>
      </div>
      {query.isLoading ? (
        <p className="mt-3 text-sm text-gray-400">Loading requests...</p>
      ) : pending.length === 0 ? (
        <p className="mt-3 text-sm text-gray-400">No pending signup requests.</p>
      ) : (
        <div className="mt-3 overflow-hidden rounded-md border border-gray-200 dark:border-gray-800">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-gray-950">
              <tr>
                <th className="px-3 py-2">Clinic</th>
                <th className="px-3 py-2">Requester</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Requested</th>
                <th className="px-3 py-2 text-right">Decision</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((request) => (
                <tr key={request.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-3 py-2 font-medium">{request.clinicName}</td>
                  <td className="px-3 py-2">{request.fullName}</td>
                  <td className="px-3 py-2 text-gray-500">{request.email}</td>
                  <td className="px-3 py-2 text-xs text-gray-400">{new Date(request.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        disabled={approve.isPending || reject.isPending}
                        onClick={() => approve.mutate(request.id)}
                        className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={approve.isPending || reject.isPending}
                        onClick={() => reject.mutate(request.id)}
                        className="rounded-md border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:hover:bg-red-950"
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(approve.isError || reject.isError || query.isError) && (
        <p className="mt-2 text-xs text-red-600">Could not update signup requests.</p>
      )}
    </section>
  )
}

function NewClinicForm() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [plan, setPlan] = useState<ClinicPlan>('starter')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => api.post('/clinics', { name, slug, plan }),
    onSuccess: () => {
      setName('')
      setSlug('')
      setPlan('starter')
      setError(null)
      qc.invalidateQueries({ queryKey: ['clinics'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (name.trim() && slug.trim()) mutation.mutate()
  }

  return (
    <form
      onSubmit={onSubmit}
      className="clinic-card mb-6 flex flex-wrap items-end gap-2 p-3"
    >
      <div>
        <label className="mb-1 block text-xs text-gray-500">{t('studio.clinics.name')}</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-gray-500">{t('studio.clinics.slug')}</label>
        <input
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          placeholder="clinica-demo"
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-gray-500">{t('studio.clinics.plan')}</label>
        <select
          value={plan}
          onChange={(e) => setPlan(e.target.value as ClinicPlan)}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
        >
          {PLANS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={mutation.isPending || !name.trim() || !slug.trim()}
        className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
      >
        {t('studio.clinics.create')}
      </button>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </form>
  )
}

function ClinicRow({ clinic, onRequestDelete }: { clinic: Clinic; onRequestDelete: (clinic: Clinic) => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [plan, setPlan] = useState<ClinicPlan>(clinic.plan)
  const [status, setStatus] = useState<ClinicStatus>(clinic.status)

  const dirty = plan !== clinic.plan || status !== clinic.status

  const mutation = useMutation({
    mutationFn: () => api.patch(`/clinics/${clinic.id}`, { plan, status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clinics'] }),
  })
  const cloneMutation = useMutation({
    mutationFn: () => {
      const suffix = new Date().toISOString().replace(/\D/g, '').slice(8, 14)
      return api.post(`/clinics/${clinic.id}/clone`, {
        name: `${clinic.name} Copy`,
        slug: `${clinic.slug}-copy-${suffix}`,
      })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clinics'] }),
  })

  return (
    <tr className="border-t border-gray-100 dark:border-gray-800">
      <td className="px-3 py-2">
        <Link prefetch={false}
          href={`/studio/clinics/${clinic.id}`}
          className="font-semibold text-teal-700 hover:text-teal-900 hover:underline dark:text-teal-300 dark:hover:text-teal-200"
        >
          {clinic.name}
        </Link>
      </td>
      <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{clinic.slug}</td>
      <td className="px-3 py-2">
        <select
          value={plan}
          onChange={(e) => setPlan(e.target.value as ClinicPlan)}
          className="rounded-md border border-gray-300 px-1.5 py-1 text-xs dark:border-gray-700 dark:bg-gray-800"
          aria-label={`${clinic.name} plan`}
        >
          {PLANS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as ClinicStatus)}
          className="rounded-md border border-gray-300 px-1.5 py-1 text-xs dark:border-gray-700 dark:bg-gray-800"
          aria-label={`${clinic.name} status`}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{clinic.timezone}</td>
      <td className="px-3 py-2 text-gray-500 dark:text-gray-400">
        {new Date(clinic.createdAt).toLocaleDateString()}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={!dirty || mutation.isPending}
            className="rounded-md bg-gray-800 px-3 py-1 text-xs font-medium text-white hover:bg-gray-900 disabled:opacity-40 dark:bg-gray-700"
          >
            {t('common.save')}
          </button>
          <button
            type="button"
            onClick={() => cloneMutation.mutate()}
            disabled={cloneMutation.isPending}
            className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Clone
          </button>
          <button
            type="button"
            onClick={() => onRequestDelete(clinic)}
            className="rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
          >
            {t('studio.clinics.delete')}
          </button>
          {mutation.isError && (
            <span role="alert" className="text-xs text-red-600">
              {mutation.error instanceof ApiError ? mutation.error.message : t('common.error')}
            </span>
          )}
          {cloneMutation.isError && (
            <span role="alert" className="text-xs text-red-600">
              {cloneMutation.error instanceof ApiError ? cloneMutation.error.message : t('common.error')}
            </span>
          )}
        </div>
      </td>
    </tr>
  )
}

// Item 1 of the 25-item batch: deleting a clinic is destructive enough to warrant
// a fresh password check, not just a click-through confirm. Follows
// ConfirmDialog.tsx's accessible modal pattern (Escape/backdrop close, focus on
// open) with a password field added.
//
// Rendered outside the clinics <table> (from ClinicsPage, not ClinicRow) — a
// <tr>-wrapped version nested inside ClinicRow's own <tr> is invalid HTML
// (tr-in-tr) that browsers silently refuse to paint, which is why the button
// looked like it did nothing.
function DeleteClinicDialog({
  open,
  clinic,
  onClose,
}: {
  open: boolean
  clinic: Clinic | null
  onClose: () => void
}) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [password, setPassword] = useState('')

  const mutation = useMutation({
    mutationFn: () => api.del(`/clinics/${clinic!.id}`, { password }),
    onSuccess: () => {
      setPassword('')
      qc.invalidateQueries({ queryKey: ['clinics'] })
      onClose()
    },
  })

  if (!open || !clinic) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          {t('studio.clinics.deleteTitle', { name: clinic.name })}
        </h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{t('studio.clinics.deleteHint')}</p>
        <label className="mt-4 block">
          <span className="mb-1 block text-xs font-medium text-gray-500">{t('studio.clinics.confirmPassword')}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-950"
          />
        </label>
        {mutation.isError && (
          <p className="mt-2 text-xs text-red-600">
            {mutation.error instanceof ApiError ? mutation.error.message : t('common.error')}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={!password.trim() || mutation.isPending}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {mutation.isPending ? t('common.saving') : t('studio.clinics.delete')}
          </button>
        </div>
      </div>
    </div>
  )
}
