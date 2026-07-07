'use client'

// Admin Studio shell — admin only (ia_studio_admin). Guards the role and frames the
// admin pages with a persistent sidebar (desktop) / slide-in drawer (mobile),
// a top bar with breadcrumbs, and a hamburger toggle.
import { useMemo, useState } from 'react'
import { CaretLeft, CaretRight, List, MagnifyingGlass } from '@phosphor-icons/react'
import { useAuthGuard } from '@/shared/hooks/useAuthGuard'
import { useHeartbeat } from '@/shared/hooks/useHeartbeat'
import { useI18n } from '@/shared/hooks/useI18n'
import { Sidebar, type NavGroup } from '@/shared/components/Sidebar'
import { NavIcon } from '@/shared/components/NavIcon'
import { HELP_UI, L } from '@/shared/help/content'
import { Breadcrumbs } from '@/shared/components/Breadcrumbs'
import { PushOptIn } from '@/shared/components/PushOptIn'
import { InstallPrompt } from '@/shared/components/InstallPrompt'
import { DocmeeLoader } from '@/shared/components/DocmeeLoader'
import { AppFooter } from '@/shared/components/AppFooter'
import { OperatorBadge } from '@/shared/components/OperatorBadge'
import { PageMascotBanner } from '@/shared/components/PageMascotBanner'
import { InAppTutorial } from '@/shared/components/InAppTutorial'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { ready, user } = useAuthGuard(['ia_studio_admin', 'clinic_admin'])
  const { t, language } = useI18n()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [railOpen, setRailOpen] = useState(true)
  useHeartbeat()
  const isSuperuser = user?.role === 'ia_studio_admin'

  // Grouped Admin Studio rail — labelled sections + a glyph per item so all admin
  // features stay scannable. "Back to inbox" is pinned below a divider.
  const groups = useMemo<NavGroup[]>(
    () => {
      const clinicItems = [
        ...(isSuperuser
          ? [
              { href: '/studio/clinics', label: t('nav.clinics'), icon: <NavIcon name="clinics" /> },
            ]
          : []),
        { href: '/studio/users', label: t('nav.users'), icon: <NavIcon name="users" /> },
        { href: '/studio/doctors', label: t('nav.doctors'), icon: <NavIcon name="doctors" /> },
      ]

      const messagingItems = [
        { href: '/studio/channels', label: t('nav.channels'), icon: <NavIcon name="channels" /> },
        { href: '/studio/quick-replies', label: t('nav.quickReplies'), icon: <NavIcon name="quickReplies" /> },
        { href: '/studio/templates', label: t('nav.templates'), icon: <NavIcon name="templates" /> },
        { href: '/studio/automations', label: t('nav.automations'), icon: <NavIcon name="automations" /> },
        {
          href: '/studio/kb',
          label: t('nav.kb'),
          icon: <NavIcon name="kb" />,
          disabled: !isSuperuser,
          disabledReason: 'Clinic KB is managed by super users.',
        },
        { href: '/studio/custom-flows', label: t('nav.customFlows'), icon: <NavIcon name="customFlows" /> },
        { href: '/studio/workflows', label: t('nav.workflows'), icon: <NavIcon name="workflows" /> },
      ]

      const operationsItems = [
        ...(isSuperuser
          ? [{ href: '/studio/errors', label: t('nav.errors'), icon: <NavIcon name="errors" /> }]
          : []),
        {
          href: '/studio/cost-monitoring',
          label: t('nav.usage'),
          icon: <NavIcon name="costMonitoring" />,
          disabled: !isSuperuser,
          disabledReason: 'Usage controls are managed by super users.',
        },
        {
          href: '/studio/license',
          label: t('nav.license'),
          icon: <NavIcon name="license" />,
          disabled: !isSuperuser,
          disabledReason: 'License controls are managed by super users.',
        },
      ]

      const complianceItems = isSuperuser
        ? [
            { href: '/studio/compliance', label: t('nav.compliance'), icon: <NavIcon name="compliance" /> },
            { href: '/studio/governance', label: 'Governance', icon: <NavIcon name="compliance" /> },
            { href: '/studio/credential-health', label: 'Credential Health', icon: <NavIcon name="shield" /> },
          ]
        : []

      return [
        ...(isSuperuser
          ? [
              {
                label: t('nav.group.clinics'),
                items: [{ href: '/studio', label: t('studio.title'), icon: <NavIcon name="studio" /> }, ...clinicItems],
              },
            ]
          : [{ label: t('nav.group.clinics'), items: clinicItems }]),
        { label: t('nav.group.messaging'), items: messagingItems },
        { label: t('nav.group.operations'), items: operationsItems },
        ...(complianceItems.length ? [{ label: t('nav.group.compliance'), items: complianceItems }] : []),
        {
          items: [
            { href: '/inbox', label: t('nav.backToInbox'), icon: <NavIcon name="inbox" /> },
            { href: '/help', label: L(HELP_UI.navHelp, language), icon: <NavIcon name="help" /> },
          ],
        },
      ]
    },
    [t, language, isSuperuser],
  )

  if (!ready) return <DocmeeLoader label={t('common.loading')} fullScreen />

  return (
    <div className="crm-app-container" data-docmee-app-shell>
      {/* Desktop sidebar */}
      <div className={railOpen ? 'hidden md:flex' : 'hidden'}>
        <Sidebar groups={groups} title={t('studio.title')} />
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
            <Sidebar groups={groups} title={t('studio.title')} />
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
          <div className="min-w-0 flex-1 basis-48">
            <Breadcrumbs />
          </div>
          <div className="crm-header-search hidden lg:flex">
            <MagnifyingGlass size={20} className="mr-3 shrink-0" />
            <input type="search" placeholder="Search settings, users, channels, or knowledge..." />
          </div>
          {/* Req 39: let an admin enable Web Push on this device too, so platform
              alerts reach them on their phone with the panel closed. */}
          <div className="crm-header-actions">
            <PushOptIn />
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
          {children}
          <AppFooter />
        </main>
      </div>

      {/* Req 23 — PWA install sheet (Add to Home Screen). */}
      <InstallPrompt />
      <InAppTutorial />
    </div>
  )
}
