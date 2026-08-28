'use client'

import { useState, type ReactNode } from 'react'
import { api } from '@/shared/api/client'
import { googleOAuthAuthUrlPath, isTrustedGoogleOAuthUrl } from '@/shared/googleOAuth'

interface GoogleOAuthButtonProps {
  clinicId: string
  doctorId?: string
  children: ReactNode
  className?: string
  wrapperClassName?: string
  loadingLabel?: string
}

export function GoogleOAuthButton({
  clinicId,
  doctorId,
  children,
  className,
  wrapperClassName,
  loadingLabel = 'Connecting...',
}: GoogleOAuthButtonProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const connect = async () => {
    setPending(true)
    setError(null)
    try {
      const { url } = await api.post<{ url: string }>(googleOAuthAuthUrlPath(clinicId, doctorId))
      if (!isTrustedGoogleOAuthUrl(url)) throw new Error('Docmee received an invalid Google authorization URL.')
      window.location.assign(url)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start Google authorization.')
      setPending(false)
    }
  }

  return (
    <span className={wrapperClassName ?? 'inline-flex flex-col items-start gap-1'}>
      <button type="button" onClick={connect} disabled={pending} className={className}>
        {pending ? loadingLabel : children}
      </button>
      {error && <span role="alert" className="max-w-72 text-xs text-red-600 dark:text-red-400">{error}</span>}
    </span>
  )
}
