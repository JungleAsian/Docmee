'use client'

// Req 11 — lifecycle timeline in the context pane. Renders the 7-state conversation
// lifecycle as a vertical timeline with the current status highlighted, so a
// secretary can see where the thread sits without reading the status dropdown.
// Reuses the ['conversation', id] query (TanStack dedupes it).
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useI18n } from '../hooks/useI18n'
import { lifecycleSteps } from '../lifecycle'
import type { Conversation } from '../types'

export function LifecyclePanel({ conversationId }: { conversationId: string }) {
  const { t } = useI18n()
  const query = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => api.get<{ conversation: Conversation }>(`/conversations/${conversationId}`),
  })
  const steps = lifecycleSteps(query.data?.conversation.status)

  return (
    <section className="border-b border-gray-200 p-4 dark:border-gray-800">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {t('lifecycle.title')}
      </h3>
      <ol className="relative ml-1.5 border-l-2 border-gray-200 dark:border-gray-700">
        {steps.map((step) => (
          <li key={step.status} className="relative flex items-center gap-3 py-1.5 pl-4">
            <span
              aria-hidden
              className={`absolute -left-[7px] h-3 w-3 rounded-full border-2 ${
                step.state === 'done'
                  ? 'border-teal-600 bg-teal-600'
                  : step.state === 'current'
                    ? 'border-teal-600 bg-white ring-2 ring-teal-100 dark:bg-gray-900 dark:ring-teal-900/50'
                    : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-900'
              }`}
            />
            <span
              className={`text-[12.5px] ${
                step.state === 'current'
                  ? 'font-bold text-teal-700 dark:text-teal-300'
                  : step.state === 'done'
                    ? 'text-gray-600 dark:text-gray-300'
                    : 'text-gray-400'
              }`}
            >
              {t(`conv.status.${step.status}` as const)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
