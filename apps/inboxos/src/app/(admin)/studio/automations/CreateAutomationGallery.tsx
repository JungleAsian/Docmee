'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { useI18n } from '@/shared/hooks/useI18n'
import { WORKFLOW_TEMPLATES } from '@/shared/workflowTemplates'
import type { FlowTemplate } from '@/shared/types'

type HubTranslateKey = Parameters<ReturnType<typeof useI18n>['t']>[0]

// R5: goal-first creation gallery — the single creation entry for all three
// automation engines. The user picks a goal (a template); the engine choice is
// deferred to the "start from scratch" fallback at the bottom. Every card
// deep-links into the owning builder (?template= / ?new=), which performs the
// actual creation — this component stays presentational.
export function CreateAutomationGallery({ clinicId }: { clinicId: string | null }) {
  const { t } = useI18n()
  const router = useRouter()
  const [revealed, setRevealed] = useState(false)
  const flowTemplatesQuery = useQuery({
    queryKey: ['custom-flow-templates', clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ templates: FlowTemplate[] }>(`/clinics/${clinicId}/custom-flows/templates`),
  })
  const flowTemplates = flowTemplatesQuery.data?.templates ?? []

  type Chip = 'workflow' | 'replyFlow' | 'scheduled'
  interface GalleryCard {
    key: string
    name: string
    desc: string
    chip: Chip
    href: string
  }

  const workflowCard = (tplKey: string): GalleryCard | null => {
    const tpl = WORKFLOW_TEMPLATES.find((x) => x.key === tplKey)
    if (!tpl) return null
    return {
      key: tpl.key,
      name: t(tpl.nameKey as HubTranslateKey),
      desc: t(tpl.descKey as HubTranslateKey),
      chip: 'workflow',
      href: `/studio/workflows?template=${tpl.key}`,
    }
  }
  const onlyCards = (cards: (GalleryCard | null)[]) => cards.filter((c): c is GalleryCard => c !== null)

  const groups: { key: string; titleKey: HubTranslateKey; cards: GalleryCard[] }[] = [
    {
      key: 'booking',
      titleKey: 'hub.goal.booking' as HubTranslateKey,
      cards: onlyCards([workflowCard('guided_whatsapp_booking'), workflowCard('single_turn_booking')]),
    },
    {
      key: 'triage',
      titleKey: 'hub.goal.triage' as HubTranslateKey,
      cards: onlyCards([workflowCard('urgent_keyword')]),
    },
    {
      key: 'replies',
      titleKey: 'hub.goal.replies' as HubTranslateKey,
      cards: flowTemplates.map((tpl) => ({
        key: tpl.key,
        name: tpl.name,
        desc: tpl.triggerKeywords.join(', '),
        chip: 'replyFlow' as Chip,
        href: `/studio/custom-flows?template=${tpl.key}`,
      })),
    },
    {
      key: 'followUps',
      titleKey: 'hub.goal.followUps' as HubTranslateKey,
      cards: [
        { key: 'followup', name: t('hub.preset.followUp.name' as HubTranslateKey), desc: t('hub.preset.followUp.desc' as HubTranslateKey), chip: 'scheduled', href: '#follow-ups' },
        { key: 'review', name: t('hub.preset.review.name' as HubTranslateKey), desc: t('hub.preset.review.desc' as HubTranslateKey), chip: 'scheduled', href: '#review' },
      ],
    },
  ]

  const CHIP_STYLE: Record<Chip, string> = {
    workflow: 'bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
    replyFlow: 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
    scheduled: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  }

  const open = (href: string) => {
    if (href.startsWith('#')) {
      document.querySelector(href)?.scrollIntoView({ behavior: 'smooth' })
    } else {
      router.push(href)
    }
  }

  const cardCls =
    'flex flex-col rounded-md border border-gray-200 p-3 text-left transition hover:border-cyan-300 hover:bg-cyan-50 dark:border-gray-800 dark:hover:border-cyan-800 dark:hover:bg-gray-800'

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-50">{t('hub.create' as HubTranslateKey)}</h2>
          <p className="mt-0.5 max-w-2xl text-sm text-gray-500 dark:text-gray-400">{t('hub.createDesc' as HubTranslateKey)}</p>
        </div>
        <button
          type="button"
          onClick={() => setRevealed((value) => !value)}
          aria-expanded={revealed}
          aria-controls="automation-template-picker"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          {revealed ? 'Hide settings' : 'Show settings'}
        </button>
      </div>

      {revealed && (
        <div id="automation-template-picker">
          <div className="mt-4 overflow-x-auto rounded-md border border-gray-200 dark:border-gray-800">
            <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
              <thead className="bg-gray-50 dark:bg-gray-950/50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">{t('hub.table.name' as HubTranslateKey)}</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">{t('hub.table.category' as HubTranslateKey)}</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">{t('hub.table.description' as HubTranslateKey)}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {groups.flatMap((group) =>
                  group.cards.length === 0
                    ? []
                    : group.cards.map((card) => (
                        <tr key={card.key} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                          <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-100">{card.name}</td>
                          <td className="px-3 py-2">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${CHIP_STYLE[card.chip]}`}>
                              {t(group.titleKey)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{card.desc}</td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => open(card.href)}
                              className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                            >
                              {t('hub.table.use' as HubTranslateKey)}
                            </button>
                          </td>
                        </tr>
                      )),
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 border-t border-gray-100 pt-3 dark:border-gray-800">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{t('hub.scratch' as HubTranslateKey)}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => open('/studio/workflows?new=1')} className={cardCls}>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{t('hub.chip.workflow' as HubTranslateKey)}</p>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{t('hub.scratch.workflowDesc' as HubTranslateKey)}</p>
              </button>
              <button type="button" onClick={() => open('/studio/custom-flows?new=1')} className={cardCls}>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{t('hub.chip.replyFlow' as HubTranslateKey)}</p>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{t('hub.scratch.flowDesc' as HubTranslateKey)}</p>
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
