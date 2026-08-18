'use client'

// Item 7 of the 25-item batch: connected WhatsApp Business Accounts shown in a
// table inside a pop-up, opened from a single pushbutton, instead of an inline
// pill list. Follows ConfirmDialog.tsx's accessible modal pattern (Escape/backdrop
// close, focus on open) but wider, to fit a table.
import { useEffect, useRef } from 'react'

export interface WabaTableRow {
  id: string
  displayName: string | null
  accountId: string
  wabaId?: string | null
  status: 'active' | 'inactive' | 'error'
}

interface WabaTableModalProps {
  open: boolean
  accounts: WabaTableRow[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAddNew: () => void
  onClose: () => void
}

export function WabaTableModal({ open, accounts, selectedId, onSelect, onAddNew, onClose }: WabaTableModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="waba-table-modal-title"
        className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="waba-table-modal-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">
              WhatsApp Business accounts
            </h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Select a row to review or update that account. Existing accounts stay unchanged unless you explicitly
              update them.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Close
          </button>
        </div>

        <div className="mt-4 max-h-96 overflow-auto rounded-md border border-gray-200 dark:border-gray-800">
          <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
            <thead className="bg-gray-50 dark:bg-gray-950/50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Name</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Phone ID</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">WABA ID</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {accounts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-xs text-gray-500 dark:text-gray-400">
                    No WABA connected for this clinic.
                  </td>
                </tr>
              ) : (
                accounts.map((item) => {
                  const selected = selectedId === item.id
                  return (
                    <tr
                      key={item.id}
                      className={selected ? 'bg-emerald-50 dark:bg-emerald-950/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'}
                    >
                      <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">
                        {item.displayName || 'WhatsApp Business'}
                      </td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{item.accountId}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{item.wabaId || 'not saved'}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                        {item.status === 'active' ? 'Active' : item.status}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => onSelect(item.id)}
                          className={
                            selected
                              ? 'rounded-md border border-emerald-500 bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100'
                              : 'rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'
                          }
                        >
                          {selected ? 'Selected' : 'Select'}
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onAddNew}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
          >
            Add another WABA
          </button>
        </div>
      </div>
    </div>
  )
}
