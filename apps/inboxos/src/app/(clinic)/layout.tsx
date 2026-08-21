'use client'

// Clinic shell (secretary, doctor, clinic_admin — and admins passing through).
// Guards authentication, runs the presence heartbeat, and frames the page with
// the shared sidebar.
import { useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { CaretLeft, CaretRight, List, MagnifyingGlass } from '@phosphor-icons/react'
import { api } from '@/shared/api/client'
import { useAuthGuard } from '@/shared/hooks/useAuthGuard'
import { useHeartbeat } from '@/shared/hooks/useHeartbeat'
import { useFeatures } from '@/shared/hooks/useFeatures'
import { useI18n } from '@/shared/hooks/useI18n'
import { can } from '@/shared/permissions'
import { roleCanSeeMenuItem, type RoleAccessSettings, type RoleMenuItemKey } from '@/shared/roleAccess'
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

export default function ClinicLayout({ children }: { children: React.ReactNode }) {
  const { ready, user } = useAuthGuard()
  const { t } = useI18n()
  const { features } = useFeatures()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [railOpen, setRailOpen] = useState(true)
  const pathname = usePathname()
  // The Inbox is a fixed-height workspace: it must fill the viewport exactly and
  // scroll only its own inner columns (message list, conversation list, context
  // rail), never the whole page. So on /inbox the content wrapper becomes a
  // flex column that fills the available height (flex-1 + min-h-0), giving its
  // child a definite height to bound its scroll areas against. Every other page
  // keeps the natural min-h-full/flex-none flow (grows with content, page scrolls).
  const fullHeightRoute = pathname === '/inbox'
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
  const groups = useMemo<NavGroup[]>(() => {
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

    const result: NavGroup[] = []
    if (workspace.length) result.push({ label: t('nav.group.workspace'), items: workspace })
    if (insights.length) result.push({ label: t('nav.group.insights'), items: insights })
    if (admin.length) result.push({ items: admin }) // unlabeled — pinned below a divider
    return result
  }, [t, user?.role, features.advancedAnalytics, settings])

  if (!ready) return <DocmeeLoader label={t('common.loading')} fullScreen />

  return (
    <div className="crm-app-container" data-docmee-app-shell>
      {/* Desktop sidebar */}
      <div className={railOpen ? 'hidden md:flex' : 'hidden'}>
        <Sidebar groups={groups} title={t('nav.inbox')} />
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
            <Sidebar groups={groups} title={t('nav.inbox')} />
          </div>
        </div>
      )}

      <div className="crm-main-content">
        <header className="crm-top-header shrink-0">
          <button
            type="button"
            aria-label={railOpen ? t('nav.hideRail') : t('nav.showRail')}
            title={railOpen ? t('nav.hideRail') : t('nav.showRail')}
            onClick={() => setRailOpen((value) => !value)}
            className="crm-icon-btn hidden md:inline-flex"
          >
            {railOpen ? <CaretLeft size={20} /> : <CaretRight size={20} />}
          </button>
          <button
            type="button"
            aria-label={t('common.openMenu')}
            onClick={() => setDrawerOpen(true)}
            className="crm-icon-btn md:hidden"
          >
            <List size={22} />
          </button>
          <div className="crm-header-search hidden lg:flex">
            <MagnifyingGlass size={20} className="mr-3 shrink-0" />
            <input type="search" placeholder="Search patients, messages, or appointments..." />
          </div>
          <div className="min-w-0 flex-1 basis-56">
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
          <PageMascotBanner />
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
