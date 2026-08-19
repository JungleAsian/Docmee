'use client'

// Req 3 — interactive reply-button composer shown in the secretary message box for
// WhatsApp threads. Opens a popover to compose a body of text plus 1–3 tappable
// reply buttons; on send it DELIVERS a real `type:'interactive'` WhatsApp message
// to the patient via onSend(body, buttons). When the patient taps a button the
// inbound webhook feeds the tapped title back as ordinary message text, so the bot
// or secretary picks up the round-trip. WhatsApp limits: ≤ 3 buttons, ≤ 20 chars
// per title (mirrored here and enforced server-side).
import { useState } from 'react'
import { useI18n } from '../hooks/useI18n'

const MAX_BUTTONS = 3
const MAX_TITLE = 20

export function InteractivePicker({
  onSend,
  disabled,
}: {
  onSend: (body: string, buttons: string[]) => void
  disabled?: boolean
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState('')
  const [buttons, setButtons] = useState<string[]>(['', ''])

  const trimmedButtons = buttons.map((b) => b.trim()).filter(Boolean)
  const canSend = body.trim().length > 0 && trimmedButtons.length > 0

  function reset() {
    setBody('')
    setButtons(['', ''])
  }

  function submit() {
    if (!canSend) return
    onSend(body.trim(), trimmedButtons)
    reset()
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={t('interactive.button')}
        aria-label={t('interactive.button')}
        className="crm-composer-icon-btn text-sm"
      >
        🔘
      </button>

      {open && (
        <div className="fixed bottom-24 left-1/2 z-30 w-72 -translate-x-1/2 rounded-md border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-700 dark:bg-gray-900">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {t('interactive.title')}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              {t('interactive.close')}
            </button>
          </div>
          <p className="mb-2 text-[10px] text-gray-400">{t('interactive.hint')}</p>

          <label className="mb-1 block text-[11px] font-medium text-gray-500">
            {t('interactive.bodyLabel')}
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            maxLength={1024}
            placeholder={t('interactive.bodyPlaceholder')}
            className="mb-2 w-full resize-none rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-teal-500 dark:border-gray-700 dark:bg-gray-800"
          />

          <label className="mb-1 block text-[11px] font-medium text-gray-500">
            {t('interactive.buttonsLabel')}
          </label>
          {buttons.map((value, i) => (
            <div key={i} className="mb-1.5 flex items-center gap-1.5">
              <input
                value={value}
                onChange={(e) =>
                  setButtons((bs) => bs.map((b, j) => (j === i ? e.target.value : b)))
                }
                maxLength={MAX_TITLE}
                placeholder={`${t('interactive.optionPlaceholder')} ${i + 1}`}
                className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-teal-500 dark:border-gray-700 dark:bg-gray-800"
              />
              {buttons.length > 1 && (
                <button
                  type="button"
                  onClick={() => setButtons((bs) => bs.filter((_, j) => j !== i))}
                  title={t('interactive.remove')}
                  aria-label={t('interactive.remove')}
                  className="rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-400 hover:text-red-600 dark:border-gray-700"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {buttons.length < MAX_BUTTONS && (
            <button
              type="button"
              onClick={() => setButtons((bs) => [...bs, ''])}
              className="mb-2 text-xs font-medium text-teal-600 hover:text-teal-700 dark:text-teal-400"
            >
              + {t('interactive.add')}
            </button>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={!canSend || disabled}
            className="mt-1 w-full rounded-md bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
          >
            {t('interactive.send')}
          </button>
        </div>
      )}
    </div>
  )
}
