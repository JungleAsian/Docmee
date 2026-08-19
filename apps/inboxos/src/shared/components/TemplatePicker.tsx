'use client'

// Req 3 — approved HSM template picker shown in the secretary message box for
// WhatsApp threads. Opens a popover listing the clinic's APPROVED WhatsApp message
// templates; clicking one SENDS it to the patient via onPick(templateId) (a real
// `type:'template'` Meta message — the only way to reach a patient outside the 24h
// window). Templates are managed/approved in Admin Studio. Distinct from the quick
// reply picker, which only inserts text into the draft for an in-window reply.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useI18n } from '../hooks/useI18n'
import type { MessageTemplate } from '../types'

export function TemplatePicker({
  conversationId,
  onPick,
  disabled,
}: {
  conversationId: string
  onPick: (templateId: string) => void
  disabled?: boolean
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  const query = useQuery({
    queryKey: ['conversation-templates', conversationId],
    enabled: open,
    queryFn: () =>
      api.get<{ templates: MessageTemplate[] }>(`/conversations/${conversationId}/templates`),
  })
  const templates = query.data?.templates ?? []

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={t('template.button')}
        aria-label={t('template.button')}
        className="crm-composer-icon-btn text-sm"
      >
        📋
      </button>

      {open && (
        <div className="fixed bottom-24 left-1/2 z-30 max-h-72 w-72 -translate-x-1/2 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2 dark:border-gray-800">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {t('template.title')}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              {t('template.close')}
            </button>
          </div>
          <p className="border-b border-gray-100 px-3 py-1.5 text-[10px] text-gray-400 dark:border-gray-800">
            {t('template.hint')}
          </p>

          {query.isLoading ? (
            <p className="p-3 text-xs text-gray-400">{t('common.loading')}</p>
          ) : templates.length === 0 ? (
            <p className="p-3 text-xs text-gray-400">{t('template.empty')}</p>
          ) : (
            <ul>
              {templates.map((tpl) => (
                <li key={tpl.id}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      onPick(tpl.id)
                      setOpen(false)
                    }}
                    className="block w-full border-b border-gray-100 px-3 py-2 text-left hover:bg-teal-50 disabled:opacity-60 dark:border-gray-800 dark:hover:bg-teal-950/40"
                  >
                    <p className="text-xs font-medium">{tpl.name}</p>
                    <p className="mt-0.5 truncate text-xs text-gray-500">{tpl.body}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
