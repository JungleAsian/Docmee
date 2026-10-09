'use client'

import { useI18n } from '../hooks/useI18n'
import { useServerTime } from '../hooks/useServerTime'

type DisplayProps = { timestamp: number | null; unavailable?: boolean; timezone?: string; compact?: boolean; className?: string }

export function ServerTimeDisplay({ timestamp, unavailable = false, timezone = 'UTC', compact = false, className = '' }: DisplayProps) {
  const { t, language } = useI18n()
  let formatted: string | null = null
  if (timestamp !== null && !unavailable) {
    try {
      formatted = new Intl.DateTimeFormat(language === 'es' ? 'es' : 'en-GB', {
        timeZone: timezone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit',
        ...(compact ? {} : { year: 'numeric', month: '2-digit', day: '2-digit' } as const),
      }).format(timestamp)
    } catch {
      // Invalid timezone data must not silently show the computer's local timezone.
      unavailable = true
    }
  }
  return <div className={`flex flex-col text-xs leading-tight text-[var(--crm-text-main)] ${className}`}>
    <span>{t('clock.serverTime')}</span>
    {formatted && timestamp !== null
      ? <span className="tabular-nums"><time dateTime={new Date(timestamp).toISOString()}>{formatted}</time> · {timezone}</span>
      : <span>{t(unavailable ? 'clock.unavailable' : 'clock.syncing')}</span>}
  </div>
}

export function ServerClock(props: Omit<DisplayProps, 'timestamp' | 'unavailable'>) {
  const { timestamp, unavailable } = useServerTime()
  return <ServerTimeDisplay {...props} timestamp={timestamp} unavailable={unavailable} />
}
