'use client'

import { useFormStatus } from 'react-dom'

type Props = {
  label: string
  disabled?: boolean
  tone?: 'primary' | 'secondary' | 'danger'
  pulse?: boolean
}

export function DeployActionButton({ label, disabled = false, tone = 'secondary', pulse = false }: Props) {
  const { pending } = useFormStatus()
  const base = 'flex min-h-12 w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-slate-900 disabled:text-slate-500'
  const color = tone === 'primary'
    ? 'bg-cyan-600 text-white hover:bg-cyan-500'
    : tone === 'danger'
      ? 'border border-red-700 text-red-100 hover:bg-red-950/50'
      : 'border border-slate-700 text-slate-100 hover:bg-slate-800'

  return (
    <button type="submit" disabled={disabled || pending} className={`${base} ${color} ${pulse && !disabled ? 'deployment-next-action' : ''}`} aria-busy={pending}>
      {pending && (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      <span>{pending ? 'Working...' : label}</span>
    </button>
  )
}
