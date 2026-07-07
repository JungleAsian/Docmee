'use client'

// Clinic picker shared by the admin pages that operate on one clinic at a time
// (KB, error review, usage). Loads the full clinic list (admin-only endpoint).
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useI18n } from '../hooks/useI18n'
import type { Clinic } from '../types'

export function useClinics() {
  return useQuery({
    queryKey: ['clinics'],
    queryFn: () => api.get<{ clinics: Clinic[] }>('/clinics'),
  })
}

export function ClinicSelect({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (clinicId: string) => void
  label: string
}) {
  const { t } = useI18n()
  const { data, isLoading } = useClinics()
  const clinics = data?.clinics ?? []

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-gray-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={isLoading}
        className="rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-teal-500 dark:border-gray-700 dark:bg-gray-800"
      >
        <option value="">{isLoading ? t('common.loading') : `— ${t('common.none')} —`}</option>
        {clinics.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  )
}
