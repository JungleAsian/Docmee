'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'

function ConfirmSubmit({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={!enabled || pending}
      className="min-h-11 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
    >
      {pending ? 'Resetting...' : 'Confirm Fresh Reset'}
    </button>
  )
}

export function ResetDeploymentButton() {
  const [confirming, setConfirming] = useState(false)
  const [phrase, setPhrase] = useState('')
  const confirmed = phrase === 'RESET DEPLOYMENT'

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="min-h-11 rounded-md border border-red-700 px-4 py-2 text-sm font-medium text-red-100 hover:bg-red-950/50"
      >
        Reset Deployment State
      </button>
    )
  }

  return (
    <div className="rounded-md border border-red-800 bg-red-950/30 p-4">
      <h3 className="text-sm font-semibold text-red-100">Confirm Fresh Deployment Reset</h3>
      <p className="mt-2 text-sm text-red-100/80">
        This clears DevTools progress, deployment checks, deployment locks, feature coverage, cost tracking, and run heartbeats.
        Credentials, VPS settings, source code, licenses, and installed dependencies are preserved.
      </p>
      <p className="mt-2 text-xs text-red-200/70">
        Previous state is archived before reset so it can be recovered if needed.
      </p>
      <form action="/api/actions" method="post" className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_auto]">
        <input type="hidden" name="action" value="deployment-reset" />
        <input
          name="confirm"
          value={phrase}
          onChange={(event) => setPhrase(event.target.value)}
          placeholder="Type RESET DEPLOYMENT"
          className="min-h-11 rounded-md border border-red-900 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
        />
        <ConfirmSubmit enabled={confirmed} />
        <button
          type="button"
          onClick={() => {
            setConfirming(false)
            setPhrase('')
          }}
          className="min-h-11 rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
        >
          Cancel
        </button>
      </form>
    </div>
  )
}
