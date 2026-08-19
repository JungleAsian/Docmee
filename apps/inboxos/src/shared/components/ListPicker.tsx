'use client'

// Req 3 — interactive LIST composer shown in the secretary message box for WhatsApp
// threads. The >3-options counterpart to InteractivePicker: opens a popover to
// compose a body, the menu button label and 1–10 selectable rows (title + optional
// description). On send it DELIVERS a real `type:'interactive'` list message to the
// patient via onSend(body, button, sections). When the patient picks a row the
// inbound webhook feeds the chosen row title back as ordinary message text, so the
// bot or secretary picks up the round-trip. WhatsApp limits (mirrored here and
// enforced server-side): ≤ 10 rows total, button ≤ 20 chars, row title ≤ 24 chars,
// row description ≤ 72 chars. To stay simple this composer offers a single section
// (no section header) — the common "pick one of N" case.
import { useState } from 'react'
import { useI18n } from '../hooks/useI18n'

const MAX_ROWS = 10
const MAX_BUTTON = 20
const MAX_TITLE = 24
const MAX_DESC = 72

interface RowDraft {
  title: string
  description: string
}

export function ListPicker({
  onSend,
  disabled,
}: {
  onSend: (
    body: string,
    button: string,
    sections: Array<{ rows: Array<{ title: string; description?: string }> }>,
  ) => void
  disabled?: boolean
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState('')
  const [button, setButton] = useState('')
  const [rows, setRows] = useState<RowDraft[]>([
    { title: '', description: '' },
    { title: '', description: '' },
  ])

  const filledRows = rows
    .map((r) => ({ title: r.title.trim(), description: r.description.trim() }))
    .filter((r) => r.title.length > 0)
  const canSend = body.trim().length > 0 && button.trim().length > 0 && filledRows.length > 0

  function reset() {
    setBody('')
    setButton('')
    setRows([
      { title: '', description: '' },
      { title: '', description: '' },
    ])
  }

  function submit() {
    if (!canSend) return
    const sections = [
      {
        rows: filledRows.map((r) => ({
          title: r.title,
          ...(r.description ? { description: r.description } : {}),
        })),
      },
    ]
    onSend(body.trim(), button.trim(), sections)
    reset()
    setOpen(false)
  }

  function patchRow(i: number, patch: Partial<RowDraft>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={t('list.button')}
        aria-label={t('list.button')}
        className="crm-composer-icon-btn text-sm"
      >
        📋
      </button>

      {open && (
        <div className="fixed bottom-24 left-1/2 z-30 max-h-[28rem] w-80 -translate-x-1/2 overflow-y-auto rounded-md border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-700 dark:bg-gray-900">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {t('list.title')}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              {t('list.close')}
            </button>
          </div>
          <p className="mb-2 text-[10px] text-gray-400">{t('list.hint')}</p>

          <label className="mb-1 block text-[11px] font-medium text-gray-500">
            {t('list.bodyLabel')}
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            maxLength={1024}
            placeholder={t('list.bodyPlaceholder')}
            className="mb-2 w-full resize-none rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-teal-500 dark:border-gray-700 dark:bg-gray-800"
          />

          <label className="mb-1 block text-[11px] font-medium text-gray-500">
            {t('list.buttonLabel')}
          </label>
          <input
            value={button}
            onChange={(e) => setButton(e.target.value)}
            maxLength={MAX_BUTTON}
            placeholder={t('list.buttonPlaceholder')}
            className="mb-2 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-teal-500 dark:border-gray-700 dark:bg-gray-800"
          />

          <label className="mb-1 block text-[11px] font-medium text-gray-500">
            {t('list.rowsLabel')}
          </label>
          {rows.map((row, i) => (
            <div
              key={i}
              className="mb-1.5 rounded-md border border-gray-200 p-1.5 dark:border-gray-700"
            >
              <div className="flex items-center gap-1.5">
                <input
                  value={row.title}
                  onChange={(e) => patchRow(i, { title: e.target.value })}
                  maxLength={MAX_TITLE}
                  placeholder={`${t('list.optionPlaceholder')} ${i + 1}`}
                  className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-teal-500 dark:border-gray-700 dark:bg-gray-800"
                />
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                    title={t('list.remove')}
                    aria-label={t('list.remove')}
                    className="rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-400 hover:text-red-600 dark:border-gray-700"
                  >
                    ✕
                  </button>
                )}
              </div>
              <input
                value={row.description}
                onChange={(e) => patchRow(i, { description: e.target.value })}
                maxLength={MAX_DESC}
                placeholder={t('list.descriptionPlaceholder')}
                className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1 text-xs outline-none focus:border-teal-500 dark:border-gray-700 dark:bg-gray-800"
              />
            </div>
          ))}
          {rows.length < MAX_ROWS && (
            <button
              type="button"
              onClick={() => setRows((rs) => [...rs, { title: '', description: '' }])}
              className="mb-2 text-xs font-medium text-teal-600 hover:text-teal-700 dark:text-teal-400"
            >
              + {t('list.add')}
            </button>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={!canSend || disabled}
            className="mt-1 w-full rounded-md bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
          >
            {t('list.send')}
          </button>
        </div>
      )}
    </div>
  )
}
