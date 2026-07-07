'use client'

import { useState } from 'react'

export function UpdateAllConfirmButton() {
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
      >
        Update All
      </button>
    )
  }

  return (
    <div className="rounded-md border border-amber-500/50 bg-amber-950/30 p-3">
      <p className="text-xs text-amber-100">Confirm package updates for all listed technologies.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <form action="/api/actions" method="post">
          <input type="hidden" name="action" value="stack-update-all" />
          <input type="hidden" name="confirm" value="UPDATE_ALL_TECHNOLOGIES" />
          <button className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500">
            Confirm Update All
          </button>
        </form>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
