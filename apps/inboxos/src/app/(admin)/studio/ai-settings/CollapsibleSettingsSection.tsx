'use client'

import { useState, type ReactNode } from 'react'

export function CollapsibleSettingsSection({
  title,
  contentId,
  headerActions,
  children,
}: {
  title: string
  contentId: string
  headerActions?: ReactNode
  children: ReactNode
}) {
  const [revealed, setRevealed] = useState(false)

  return (
    <section className="clinic-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {headerActions}
          <button
            type="button"
            onClick={() => setRevealed((value) => !value)}
            aria-expanded={revealed}
            aria-controls={contentId}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {revealed ? 'Hide settings' : 'Show settings'}
          </button>
        </div>
      </div>

      {revealed && (
        <div id={contentId} className="mt-3">
          {children}
        </div>
      )}
    </section>
  )
}
