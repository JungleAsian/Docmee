'use client'

// Shared left navigation rail used by both the clinic and admin shells. Renders a
// brand header, the supplied nav links (active-aware), a language toggle and the
// user identity + logout.
import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { CaretDown, Leaf, Lifebuoy, SignOut } from '@phosphor-icons/react'
import { useI18n } from '../hooks/useI18n'
import { useLogout } from '../hooks/useLogout'
import { LanguageToggle } from './LanguageToggle'
import { ThemeToggle } from './ThemeToggle'

export interface NavLink {
  href: string
  label: string
  icon?: ReactNode
  disabled?: boolean
  disabledReason?: string
}

// An optional labelled section. A group with no label renders its items under a
// thin divider (used to pin "Back to inbox" at the bottom).
export interface NavGroup {
  label?: string
  items: NavLink[]
}

const SIDEBAR_GROUP_PREFERENCES_KEY = 'docmee:sidebar:expanded-groups:v1'

function isActiveLink(pathname: string, href: string) {
  return pathname === href || (href !== '/studio' && pathname.startsWith(`${href}/`))
}

function getGroupKey(group: NavGroup, index: number) {
  return group.items.map((item) => item.href).join('|') || `group-${index}`
}

function getDefaultExpandedGroups(groups: NavGroup[], pathname: string) {
  return Object.fromEntries(
    groups.map((group, index) => [
      getGroupKey(group, index),
      !group.label || group.items.some((item) => isActiveLink(pathname, item.href)),
    ]),
  )
}

export function Sidebar({
  links,
  groups,
  title,
  collapsed = false,
  railToggle,
}: {
  links?: NavLink[]
  groups?: NavGroup[]
  title: string
  /** Icon-only mini rail (the "hidden" state shows page icons instead of nothing). */
  collapsed?: boolean
  railToggle?: {
    expanded: boolean
    onToggle: () => void
    label: string
  }
}) {
  const pathname = usePathname()
  const { t, language } = useI18n()
  const logout = useLogout()
  const navGroups = groups ?? []
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() =>
    getDefaultExpandedGroups(navGroups, pathname),
  )

  useEffect(() => {
    if (!groups) return

    try {
      const stored = window.localStorage.getItem(SIDEBAR_GROUP_PREFERENCES_KEY)
      const preferences = stored ? JSON.parse(stored) as Record<string, boolean> : {}
      const activeDefaults = getDefaultExpandedGroups(groups, pathname)
      setExpandedGroups(Object.fromEntries(
        groups.map((group, index) => {
          const key = getGroupKey(group, index)
          const active = group.items.some((item) => isActiveLink(pathname, item.href))
          return [key, active || (preferences[key] ?? activeDefaults[key])]
        }),
      ))
    } catch {
      setExpandedGroups(getDefaultExpandedGroups(groups, pathname))
    }
  }, [groups, pathname])

  const toggleGroup = (key: string) => {
    setExpandedGroups((current) => {
      const next = { ...current, [key]: !current[key] }
      try {
        window.localStorage.setItem(SIDEBAR_GROUP_PREFERENCES_KEY, JSON.stringify(next))
      } catch {
        // Storage can be unavailable in private or restricted browser contexts.
      }
      return next
    })
  }

  const renderLink = (link: NavLink) => {
    const active = isActiveLink(pathname, link.href)
    const labelTitle = collapsed && typeof link.label === 'string' ? link.label : undefined
    if (link.disabled) {
      return (
        <span
          key={link.href}
          aria-disabled="true"
          title={link.disabledReason ?? labelTitle}
          className="crm-nav-item pointer-events-none cursor-not-allowed opacity-40 grayscale"
        >
          {link.icon ? <span className="crm-nav-item-icon shrink-0 text-[20px] opacity-70">{link.icon as never}</span> : null}
          {!collapsed && <span className="crm-nav-item-label">{link.label}</span>}
        </span>
      )
    }
    return (
      <Link
        key={link.href}
        href={link.href}
        prefetch={false}
        title={labelTitle}
        aria-current={active ? 'page' : undefined}
        className={`crm-nav-item ${active ? 'crm-nav-item-active' : ''}`}
      >
        {link.icon ? <span className="crm-nav-item-icon shrink-0 text-[20px] opacity-90">{link.icon as never}</span> : null}
        {!collapsed && <span className="crm-nav-item-label">{link.label}</span>}
      </Link>
    )
  }

  return (
    <aside className={`crm-sidebar flex shrink-0 flex-col ${collapsed ? 'crm-sidebar-collapsed' : ''}`}>
      {railToggle ? (
        <button
          type="button"
          aria-label={railToggle.label}
          title={railToggle.label}
          aria-expanded={railToggle.expanded}
          onClick={railToggle.onToggle}
          className="crm-sidebar-leaf-toggle hidden md:inline-flex"
        >
          <Leaf size={18} weight="fill" aria-hidden="true" />
        </button>
      ) : null}
      <div className="crm-sidebar-header">
        {collapsed ? (
          <div className="flex items-center justify-center px-0 py-3">
            <img src="/pets/docmee-robotito.png?v=20260828" alt={t('app.name')} className="h-[49.92px] w-[49.92px] shrink-0 object-contain" />
          </div>
        ) : (
          <div className="crm-logo">
            <div className="min-w-0 leading-tight">
              <div className="crm-sidebar-logo-wordmark" aria-label={`${t('app.name')} registered trademark`}>
                <span className="crm-sidebar-logo-doc">doc</span>
                <span className="crm-sidebar-logo-mee">mee</span>
                <span className="crm-sidebar-logo-registered" aria-hidden="true">®</span>
              </div>
              <p className="crm-sidebar-logo-tagline">Chatbot de IA para médicos</p>
              <p className="mt-1.5 break-words text-[8px] font-semibold uppercase tracking-wide text-[var(--crm-text-muted)]">{title}</p>
            </div>
          </div>
        )}
      </div>

      <div className="crm-sidebar-nav-shell">
        <nav className="crm-sidebar-nav min-h-0" aria-label={title}>
          {groups
            ? groups.map((group, i) => {
                const key = getGroupKey(group, i)
                const groupId = `crm-sidebar-group-${i}`
                const active = group.items.some((item) => isActiveLink(pathname, item.href))
                const expanded = collapsed || !group.label || (expandedGroups[key] ?? active)

                return (
                  <div
                    key={key}
                    className={`crm-nav-group ${group.label ? 'crm-nav-group-labelled' : 'crm-nav-group-unlabelled mt-2 border-t border-[var(--crm-border-color)] pt-3'}`}
                    data-active={active ? 'true' : undefined}
                  >
                    {group.label && !collapsed ? (
                      <button
                        type="button"
                        className="crm-nav-group-toggle"
                        aria-expanded={expanded}
                        aria-controls={groupId}
                        onClick={() => toggleGroup(key)}
                      >
                        <span className="crm-nav-group-label">{group.label}</span>
                        <CaretDown className="crm-nav-group-caret" size={13} weight="bold" aria-hidden="true" />
                      </button>
                    ) : null}
                    <div id={groupId} className="crm-nav-group-items space-y-0.5" hidden={!expanded}>
                      {group.items.map(renderLink)}
                    </div>
                  </div>
                )
              })
            : (links ?? []).map(renderLink)}
        </nav>
      </div>

      <div className="crm-sidebar-footer">
        <LanguageToggle compact={collapsed} />
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event('docmee:tutorial-open'))}
          title={collapsed ? (language === 'en' ? 'Tutorial' : 'Recorrido') : undefined}
          className="crm-nav-item w-full"
        >
          <Lifebuoy size={20} />
          {!collapsed && <span>{language === 'en' ? 'Tutorial' : 'Recorrido'}</span>}
        </button>
        <button
          type="button"
          onClick={() => void logout()}
          title={collapsed ? t('nav.logout') : undefined}
          className="crm-nav-item w-full"
        >
          <SignOut size={20} />
          {!collapsed && <span>{t('nav.logout')}</span>}
        </button>
        <ThemeToggle compact={collapsed} />
      </div>
    </aside>
  )
}
