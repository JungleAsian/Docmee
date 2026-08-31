'use client'

// Clinic shell (secretary, doctor, clinic_admin — and admins passing through).
// Guards authentication, runs the presence heartbeat, and frames the page with
// the shared sidebar.
import { useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { CaretLeft, CaretRight, List, MagnifyingGlass, SlidersHorizontal } from '@phosphor-icons/react'
import { api } from '@/shared/api/client'
import { useAuthGuard } from '@/shared/hooks/useAuthGuard'
import { useHeartbeat } from '@/shared/hooks/useHeartbeat'
import { useFeatures } from '@/shared/hooks/useFeatures'
import { useI18n } from '@/shared/hooks/useI18n'
import { can } from '@/shared/permissions'
import { roleCanSeeMenuItem, type RoleAccessSettings, type RoleMenuItemKey } from '@/shared/roleAccess'
import { ClinicBackButton } from '@/shared/components/ClinicBackButton'
import { Sidebar, type NavGroup, type NavLink } from '@/shared/components/Sidebar'
import { NavIcon } from '@/shared/components/NavIcon'
import { NotificationBell } from '@/shared/components/NotificationBell'
import { PushOptIn } from '@/shared/components/PushOptIn'
import { InstallPrompt } from '@/shared/components/InstallPrompt'
import { ClinicSwitcher } from '@/shared/components/ClinicSwitcher'
import { DocmeeLoader } from '@/shared/components/DocmeeLoader'
import { AppFooter } from '@/shared/components/AppFooter'
import { OperatorBadge } from '@/shared/components/OperatorBadge'
import { PageMascotBanner } from '@/shared/components/PageMascotBanner'
import { InAppTutorial } from '@/shared/components/InAppTutorial'
import { useUserUiPreferences } from '@/shared/hooks/useUserUiPreferences'
import { visibleOrderedItems } from '@/shared/userUiPreferences'

type OrderedNavGroup = NavGroup & { id: string }

export default function ClinicLayout({ children }: { children: React.ReactNode }) {
  const { ready, user } = useAuthGuard()
  const { t } = useI18n()
  const { features } = useFeatures()
  const { preferences, setPreferences } = useUserUiPreferences()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const railOpen = preferences.railExpanded
  const toggleRail = () => setPreferences({ railExpanded: !railOpen })
  // Customize menu (mirrors Admin Studio): hide/show individual side-rail items
  // through the authenticated user preference row. RBAC filters unavailable
  // routes before this preference is applied.
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const hiddenItems = useMemo(() => new Set(preferences.hiddenSideRailItems), [preferences.hiddenSideRailItems])
  function toggleHidden(href: string) {
    const next = new Set(hiddenItems)
    if (next.has(href)) next.delete(href)
    else next.add(href)
    setPreferences({ hiddenSideRailItems: [...next] })
  }
  const pathname = usePathname()
  // The Inbox is a fixed-height workspace: it must fill the viewport exactly and
  // scroll only its own inner columns (message list, conversation list, context
  // rail), never the whole page. So on /inbox the content wrapper becomes a
  // flex column that fills the available height (flex-1 + min-h-0), giving its
  // child a definite height to bound its scroll areas against. Every other page
  // keeps the natural min-h-full/flex-none flow (grows with content, page scrolls).
  const inboxRoute = pathname === '/inbox'
  const fullHeightRoute = inboxRoute
  const clinicId = user?.clinicId
  const clinicQuery = useQuery({
    queryKey: ['clinic', clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ clinic: { id: string; settings?: RoleAccessSettings | null } }>(`/clinics/${clinicId}`),
  })
  const settings = clinicQuery.data?.clinic.settings ?? {}
  useHeartbeat()

  // Req 2: nav links derive from the shared RBAC matrix (mirrors the API's
  // requireRole gating) so a role only ever sees surfaces it can actually use.
  // Req 2: nav derives from the RBAC matrix; grouped + iconified to match the IA
  // Studio rail. Each section only appears if the role has items in it.
  const groups = useMemo<OrderedNavGroup[]>(() => {
    const role = user?.role
    const show = (item: RoleMenuItemKey) => roleCanSeeMenuItem(role, item, settings)

    const workspace: NavLink[] = []
    if (can(role, 'inbox') && show('inbox')) workspace.push({ href: '/inbox', label: t('nav.inbox'), icon: <NavIcon name="inbox" /> })
    // Alerts center (Screen 11) — available to everyone who can see the inbox.
    if (can(role, 'inbox') && show('alerts')) workspace.push({ href: '/alerts', label: t('nav.alerts'), icon: <NavIcon name="alerts" /> })
    if (can(role, 'calendar') && show('calendar')) workspace.push({ href: '/calendar', label: t('nav.calendar'), icon: <NavIcon name="calendar" /> })
    if (can(role, 'calendar') && show('waitlist')) workspace.push({ href: '/waitlist', label: t('nav.waitlist'), icon: <NavIcon name="clock" /> })
    workspace.push({ href: '/help', label: t('nav.help'), icon: <NavIcon name="help" /> })

    const insights: NavLink[] = []
    // Req 40: the advanced analytics dashboard is additionally gated behind a
    // server feature flag (capability is necessary but not sufficient).
    if (can(role, 'analytics') && show('analytics') && features.advancedAnalytics) {
      insights.push({ href: '/analytics', label: t('nav.analytics'), icon: <NavIcon name="analytics" /> })
    }
    if (can(role, 'qos') && show('qos')) insights.push({ href: '/qos', label: t('nav.qos'), icon: <NavIcon name="qos" /> })
    if (can(role, 'reports') && show('reports')) insights.push({ href: '/reports', label: t('nav.reports'), icon: <NavIcon name="reports" /> })

    const admin: NavLink[] = []
    if (can(role, 'studio') && show('studio')) admin.push({ href: role === 'clinic_admin' ? '/studio/users' : '/studio/clinics', label: t('nav.studio'), icon: <NavIcon name="studio" /> })

    const result: OrderedNavGroup[] = []
    if (workspace.length) result.push({ id: 'clinic.workspace', label: t('nav.group.workspace'), items: workspace })
    if (insights.length) result.push({ id: 'clinic.insights', label: t('nav.group.insights'), items: insights })
    if (admin.length) result.push({ id: 'clinic.admin', items: admin }) // unlabeled — pinned below a divider
    return result
  }, [t, user?.role, features.advancedAnalytics, settings])

  // The sidebar shows only items the operator hasn't hidden via the customize menu.
  const visibleGroups = useMemo<NavGroup[]>(
    () => {
      const byId = new Map(groups.map((group) => [group.id, group]))
      return visibleOrderedItems(preferences.sideRailSectionOrder, groups.map((group) => group.id), [])
        .map((id) => byId.get(id))
        .filter((group): group is OrderedNavGroup => Boolean(group))
        .map((group) => ({
          ...group,
          items: visibleOrderedItems(preferences.sideRailItemOrder[group.id], group.items.map((item) => item.href), preferences.hiddenSideRailItems)
            .map((href) => group.items.find((item) => item.href === href))
            .filter((item): item is NonNullable<typeof item> => Boolean(item)),
        }))
        .filter((group) => group.items.length > 0)
    },
    [groups, preferences.hiddenSideRailItems, preferences.sideRailItemOrder, preferences.sideRailSectionOrder],
  )

  if (!ready) return <DocmeeLoader label={t('common.loading')} fullScreen />

  return (
    <div className={`crm-app-container ${inboxRoute ? 'crm-inboxos-desktop-shell' : ''}`} data-docmee-app-shell>
      {/* Desktop sidebar — collapses to an icon-only rail when toggled off
          instead of hiding entirely. */}
      <div className="hidden md:flex">
        <Sidebar
          groups={visibleGroups}
          title={t('nav.inbox')}
          collapsed={!railOpen}
          railToggle={{
            expanded: railOpen,
            onToggle: toggleRail,
            label: railOpen ? t('nav.hideRail') : t('nav.showRail'),
          }}
        />
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <button
            type="button"
            aria-label={t('common.closeMenu')}
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div className="relative z-10" onClick={() => setDrawerOpen(false)}>
            <Sidebar groups={visibleGroups} title={t('nav.inbox')} />
          </div>
        </div>
      )}

      <div className="crm-main-content">
        <header className="crm-top-header shrink-0">
          {!inboxRoute && (
            <button
              type="button"
              aria-label={railOpen ? t('nav.hideRail') : t('nav.showRail')}
              title={railOpen ? t('nav.hideRail') : t('nav.showRail')}
              onClick={toggleRail}
              className="crm-icon-btn hidden md:inline-flex"
            >
              {railOpen ? <CaretLeft size={20} /> : <CaretRight size={20} />}
            </button>
          )}
          <button
            type="button"
            aria-label={t('common.openMenu')}
            onClick={() => setDrawerOpen(true)}
            className="crm-icon-btn md:hidden"
          >
            <List size={22} />
          </button>
          <ClinicBackButton />
          <div className="relative">
            <button
              type="button"
              aria-label={t('nav.customizeMenu')}
              title={t('nav.customizeMenu')}
              onClick={() => setCustomizeOpen((v) => !v)}
              className="crm-icon-btn hidden md:inline-flex"
            >
              <SlidersHorizontal size={18} />
            </button>
            {customizeOpen && (
              <div className="absolute left-0 top-full z-30 mt-1 max-h-96 w-72 overflow-y-auto rounded-md border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-900">
                <p className="mb-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  {t('nav.customizeMenu')}
                </p>
                {groups.map((group, gi) => (
                  <div key={group.label ?? gi} className="mb-1">
                    {group.label && (
                      <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{group.label}</p>
                    )}
                    {group.items.map((item) => (
                      <label
                        key={item.href}
                        className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                      >
                        <input
                          type="checkbox"
                          checked={!hiddenItems.has(item.href)}
                          onChange={() => toggleHidden(item.href)}
                        />
                        <span className="truncate">{item.label}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
          {inboxRoute && (
            <div className="crm-inboxos-brand hidden lg:block" aria-label={t('app.name')}>
              <img src="/brand/docmee-logo.png?v=20260821" alt={t('app.name')} />
              <span>Chatbot de IA para médicos</span>
            </div>
          )}
          <div className="crm-header-search hidden lg:flex">
            <MagnifyingGlass size={20} className="mr-3 shrink-0" />
            <input type="search" placeholder="Search patients, messages, or appointments..." />
          </div>
          <div className={inboxRoute ? 'crm-inboxos-clinic-switcher min-w-0 flex-1 basis-56' : 'min-w-0 flex-1 basis-56'}>
            <ClinicSwitcher />
          </div>
          <div className="crm-header-actions">
            <PushOptIn />
            <NotificationBell />
            {user && (
              <div className="crm-user-profile">
                <span className="crm-avatar">{(user.fullName || user.email || 'U').slice(0, 2).toUpperCase()}</span>
                <OperatorBadge email={user.email} fullName={user.fullName} role={user.role} />
              </div>
            )}
          </div>
        </header>
        <main className="crm-dashboard-content">
          {preferences.imageBannersVisible && !inboxRoute && <PageMascotBanner />}
          {/* The content wrapper GROWS to fill the scroll column so the footer is
              always pushed to the bottom of the screen (sticky-footer) and never
              overlaps the page's own elements: on a short page it fills the gap; on
              a tall one it grows to its content and the column scrolls, with the
              footer after the content. The Inbox additionally scrolls only its own
              inner columns (min-h-0 + flex-col), never the whole page. */}
          <div className={fullHeightRoute ? 'flex min-h-0 flex-1 flex-col' : 'flex-1'}>
            {children}
          </div>
          {/* The Inbox is a full-height workspace; the marketing tagline footer is
              dead space there, so reclaim it for the grid. Every other page keeps
              the sticky footer. */}
          {!fullHeightRoute && <AppFooter />}
        </main>
      </div>

      {/* Req 23 — PWA install sheet (Add to Home Screen); renders only when the
          browser offers installation and the app isn't already installed. */}
      <InstallPrompt />
      <InAppTutorial />
    </div>
  )
}
