'use client'

// Screen 4 — the two messaging surfaces (WhatsApp templates + Quick replies) read
// as one screen in the design map but are two separate admin routes. This shared
// tab strip links between them and marks the active one, matching the mockup's
// two-tab header so an admin can move between them without the sidebar.
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useI18n } from '../hooks/useI18n'

export function StudioMessagingTabs() {
  const { t } = useI18n()
  const pathname = usePathname()
  const tabs = [
    { href: '/studio/templates', label: t('studio.templates.tabTemplates') },
    { href: '/studio/quick-replies', label: t('studio.templates.tabQuickReplies') },
  ]
  return (
    <nav className="mb-5 flex gap-1 border-b border-gray-200 dark:border-gray-800">
      {tabs.map((tab) => {
        const active = pathname === tab.href
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              active
                ? 'border-teal-600 text-gray-900 dark:border-teal-400 dark:text-gray-100'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
