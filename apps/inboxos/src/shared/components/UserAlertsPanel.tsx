'use client'

import type { TranslationKey } from '@/shared/i18n'
import { PillToggle } from '@/shared/components/PillToggle'
import { useI18n } from '@/shared/hooks/useI18n'

export const ALERT_CATEGORIES = ['whatsapp', 'internal', 'newBooking', 'cancellation', 'bookingRevision'] as const
export type AlertCategoryKey = (typeof ALERT_CATEGORIES)[number]
export type AlertCategories = Record<AlertCategoryKey, boolean>

export const DEFAULT_ALERT_CATEGORIES: AlertCategories = {
  whatsapp: true,
  internal: true,
  newBooking: true,
  cancellation: true,
  bookingRevision: true,
}

export function readAlertCategories(source?: { alertCategories?: Partial<AlertCategories> | null } | null): AlertCategories {
  return {
    ...DEFAULT_ALERT_CATEGORIES,
    ...(source?.alertCategories ?? {}),
  }
}

interface UserAlertsPanelProps {
  value: AlertCategories
  onChange: (next: AlertCategories) => void
  soundEnabled?: boolean
  onSoundEnabledChange?: (enabled: boolean) => void
  disabled?: boolean
  className?: string
}

export function UserAlertsPanel({
  value,
  onChange,
  soundEnabled,
  onSoundEnabledChange,
  disabled = false,
  className = '',
}: UserAlertsPanelProps) {
  const { t } = useI18n()
  const selected = ALERT_CATEGORIES.filter((key) => value[key]).length

  return (
    <section className={`rounded-md border border-gray-200 p-3 dark:border-gray-800 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{t('studio.users.alertsTitle')}</p>
          <p className="text-xs text-gray-400">{t('studio.users.alertsHint')}</p>
        </div>
        <div className="flex items-center gap-3">
          {typeof soundEnabled === 'boolean' && onSoundEnabledChange && (
            <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span aria-hidden>🔔</span>
              <span>{t('notif.prefs.soundShort')}</span>
              <PillToggle
                checked={soundEnabled}
                disabled={disabled}
                label={t('notif.prefs.soundEnabled')}
                onChange={onSoundEnabledChange}
                size="sm"
              />
            </label>
          )}
          <span className="text-xs text-gray-400">
            {selected}/{ALERT_CATEGORIES.length}
          </span>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {ALERT_CATEGORIES.map((key) => (
          <label
            key={key}
            className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-gray-800"
          >
            <span>{t(('studio.users.alert.' + key) as TranslationKey)}</span>
            <PillToggle
              checked={value[key]}
              disabled={disabled}
              label={t(('studio.users.alert.' + key) as TranslationKey)}
              onChange={(checked) => onChange({ ...value, [key]: checked })}
              size="sm"
            />
          </label>
        ))}
      </div>
    </section>
  )
}
