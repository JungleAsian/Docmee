'use client'

// Shared left navigation rail used by both the clinic and admin shells. Renders a
// brand header, the supplied nav links (active-aware), a language toggle and the
// user identity + logout.
import Link from 'next/link'
import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { Lifebuoy, SignOut } from '@phosphor-icons/react'
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

export function Sidebar({ links, groups, title }: { links?: NavLink[]; groups?: NavGroup[]; title: string }) {
  const pathname = usePathname()
  const { t, language } = useI18n()
  const logout = useLogout()

  const renderLink = (link: NavLink) => {
    const active = pathname === link.href || (link.href !== '/studio' && pathname.startsWith(`${link.href}/`))
    if (link.disabled) {
      return (
        <span
          key={link.href}
          aria-disabled="true"
          title={link.disabledReason}
          className="crm-nav-item pointer-events-none cursor-not-allowed opacity-40 grayscale"
        >
          {link.icon ? <span className="shrink-0 text-[20px] opacity-70">{link.icon as never}</span> : null}
          <span className="truncate">{link.label}</span>
        </span>
      )
    }
    return (
      <Link
        key={link.href}
        href={link.href}
        className={`crm-nav-item ${active ? 'crm-nav-item-active' : ''}`}
      >
        {link.icon ? <span className="shrink-0 text-[20px] opacity-90">{link.icon as never}</span> : null}
        <span className="truncate">{link.label}</span>
      </Link>
    )
  }

  return (
    <aside className="crm-sidebar flex shrink-0 flex-col">
      <div className="crm-sidebar-header">
        <div className="crm-logo">
          <div className="min-w-0 leading-tight">
            <img
              src="/brand/docmee-logo-auth.svg?v=20260630-markclose"
              alt={t('app.name')}
              className="crm-sidebar-logo-wordmark"
            />
            <p className="mt-1.5 break-words text-[10px] font-semibold uppercase tracking-wide text-[var(--crm-text-muted)]">{title}</p>
          </div>
        </div>
      </div>

      <nav className="crm-sidebar-nav min-h-0">
        {groups
          ? groups.map((group, i) => (
              <div
                key={group.label ?? `group-${i}`}
                className={group.label ? '' : 'mt-2 border-t border-[var(--crm-border-color)] pt-3'}
              >
                {group.label ? (
                  <p className="crm-nav-group-label">
                    {group.label}
                  </p>
                ) : null}
                <div className="space-y-0.5">{group.items.map(renderLink)}</div>
              </div>
            ))
          : (links ?? []).map(renderLink)}
      </nav>

      <div className="crm-sidebar-footer">
        <LanguageToggle />
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event('docmee:tutorial-open'))}
          className="crm-nav-item w-full"
        >
          <Lifebuoy size={20} />
          <span>{language === 'en' ? 'Tutorial' : 'Recorrido'}</span>
        </button>
        <button
          type="button"
          onClick={() => void logout()}
          className="crm-nav-item w-full"
        >
          <SignOut size={20} />
          <span>{t('nav.logout')}</span>
        </button>
        <ThemeToggle />
      </div>
    </aside>
  )
}
