'use client'

// Colored pill for a clinic's license state, shared by the clinic detail page and
// the License Management overview.
import { useI18n } from '../hooks/useI18n'
import type { LicenseState } from '../types'

const STYLES: Record<LicenseState, string> = {
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  expired: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  invalid: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  none: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
}

export function LicenseBadge({ state }: { state: LicenseState }) {
  const { t } = useI18n()
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STYLES[state]}`}>
      {t(`license.state.${state}` as const)}
    </span>
  )
}
