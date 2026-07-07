'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState, useTransition, type MouseEvent } from 'react'
import { SpanishTranslator } from './spanish-translator'

type DashboardShellProps = {
  children: ReactNode
  nav: NavItem[]
  subLabels?: Record<string, string>
}
export type NavItem = [label: string, href: string]
type NavGroup = {
  label: string
  items: string[]
}
type HeartbeatState = {
  live?: boolean
  run?: { phase?: string; heartbeatAt?: string; heartbeatAgeMs?: number; message?: string }
  heartbeat?: { status?: string }
  featureLive?: boolean
  featureRun?: { phase?: string; heartbeatAt?: string; heartbeatAgeMs?: number; message?: string }
  featureHeartbeat?: { status?: string }
  frontendLive?: boolean
  frontendRun?: { phase?: string; heartbeatAt?: string; heartbeatAgeMs?: number; message?: string }
  frontendHeartbeat?: { status?: string }
  uiLive?: boolean
  uiRun?: { phase?: string; heartbeatAt?: string; heartbeatAgeMs?: number; message?: string }
  uiHeartbeat?: { status?: string }
}
type ProjectMetrics = {
  generatedAt?: string
  totalCost?: number
  totalTokens?: number
  buildCost?: number
  buildTokens?: number
  backendCost?: number
  backendTokens?: number
  frontendCost?: number
  frontendTokens?: number
  uiCost?: number
  uiTokens?: number
  allDevelopmentCost?: number
  allDevelopmentTokens?: number
  phase?: { current?: string; done?: number; total?: number; status?: string; message?: string }
}

const spanishLabels: Record<string, string> = {
  Workspace: 'Trabajo',
  Development: 'Desarrollo',
  Deployment: 'Despliegue',
  Accounts: 'Cuentas',
  Sentinel: 'Sentinel',
  Operations: 'Operaciones',
  Integrations: 'Integraciones',
  System: 'Sistema',
  Backlog: 'Pendientes',
  'Features Development': 'Features',
  'Docmee - UI': 'UI',
  'Docmee Deployment': 'Despliegue',
  'Frontend Build Control': 'Frontend',
  Enhancements: 'Mejoras',
  Claude: 'Claude',
  Codex: 'Codex',
  Grok: 'Grok',
  Gemini: 'Gemini',
  'Codex Switch': 'Codex',
  'Build Control': 'Control',
  'Six Gates': 'Controles',
  'Phase Progress': 'Fases',
  'Development Cost': 'Costo',
  'Stack Intelligence': 'Stack',
  'Docmee Update': 'Actualizar',
  Beacon: 'Beacon',
  Forge: 'Forge',
  Guardian: 'Guardian',
  Aegis: 'Aegis',
  Healer: 'Healer',
  Cortex: 'Cortex',
  Diagnostics: 'Diagnostico',
  Ready: 'Listo',
  Agents: 'Agentes',
  Logs: 'Registros',
  'Webhook Console': 'Webhooks',
  'Seed Generator': 'Datos',
  'Discord Status': 'Discord',
  'Pre-deployment': 'Pre-Deploy',
  'Post-Deployment Log': 'Post-Deploy',
  Deploy: 'Despliegue',
  Settings: 'Configuracion'
}

const navIcons: Record<string, ReactNode> = {
  Workflow: '/lineicons/dashboard-square-1.svg',
  Workspace: '/lineicons/layers-1.svg',
  Development: '/lineicons/build-play.svg',
  Deployment: '/lineicons/deployment-guide.svg',
  Accounts: '/lineicons/account-switch.svg',
  Operations: '/lineicons/bar-chart-4.svg',
  Integrations: '/lineicons/webhooks.svg',
  System: '/lineicons/gear-1.svg',
  Ready: '/lineicons/check-circle-1.svg',
  Backlog: '/lineicons/backlog-list.svg',
  'Features Development': '/lineicons/coverage-grid.svg',
  'Docmee - UI': '/lineicons/verify-report.svg',
  'Docmee Deployment': '/lineicons/deployment-guide.svg',
  'Frontend Build Control': '/lineicons/verify-report.svg',
  Enhancements: '/lineicons/update-cycle.svg',
  Claude: '/lineicons/account-switch.svg',
  Codex: '/lineicons/codex-spark.svg',
  Grok: '/lineicons/gears-3.svg',
  Gemini: '/lineicons/codex-spark.svg',
  'Codex Switch': '/lineicons/codex-spark.svg',
  'Claude Switch': '/lineicons/account-switch.svg',
  'Build Control': '/lineicons/build-play.svg',
  'Phase Progress': '/lineicons/bar-chart-4.svg',
  'Six Gates': '/lineicons/shield-2-check.svg',
  'Post-Deployment Log': '/lineicons/verify-report.svg',
  'Pre-deployment': '/lineicons/preflight.svg',
  'Docmee Update': '/lineicons/update-cycle.svg',
  Deploy: '/lineicons/deployment-guide.svg',
  'Install Monitor': '/lineicons/heart.svg',
  Sentinel: '/lineicons/shield-2-check.svg',
  Beacon: '/lineicons/heart.svg',
  Forge: '/lineicons/build-play.svg',
  Guardian: '/lineicons/shield-2-check.svg',
  Aegis: '/lineicons/preflight.svg',
  Healer: '/lineicons/heart.svg',
  Cortex: '/lineicons/gears-3.svg',
  Diagnostics: '/lineicons/bug-1.svg',
  Logs: '/lineicons/file-multiple.svg',
  'Discord Status': '/lineicons/discord-chat.svg',
  'Development Cost': '/lineicons/dollar-circle.svg',
  'Stack Intelligence': '/lineicons/layers-1.svg',
  Agents: '/lineicons/gears-3.svg',
  'Webhook Console': '/lineicons/webhooks.svg',
  'Seed Generator': '/lineicons/database-2.svg',
  Settings: '/lineicons/gear-1.svg'
}

// Grouped to read top-to-bottom as the development → deployment workflow:
// Plan → Develop → Verify → Deploy → Monitor, then the supporting groups.
const sideRailGroups: NavGroup[] = [
  {
    label: 'Plan',
    items: ['Workflow', 'Backlog']
  },
  {
    label: 'Develop',
    items: ['Build Control', 'Phase Progress', 'Features Development', 'Frontend Build Control', 'Docmee - UI', 'Enhancements']
  },
  {
    label: 'Verify',
    items: ['Ready', 'Six Gates', 'Pre-deployment', 'Post-Deployment Log']
  },
  {
    label: 'Deploy',
    items: ['Docmee Deployment', 'Deploy', 'Docmee Update']
  },
  {
    label: 'Monitor',
    items: ['Install Monitor', 'Development Cost', 'Logs', 'Discord Status']
  },
  {
    label: 'AI',
    items: ['Claude', 'Codex', 'Grok', 'Gemini', 'Agents']
  },
  {
    label: 'Sentinel',
    items: ['Sentinel', 'Healer', 'Beacon', 'Forge', 'Guardian', 'Aegis', 'Cortex', 'Diagnostics']
  },
  {
    label: 'System',
    items: ['Stack Intelligence', 'Webhook Console', 'Seed Generator', 'Settings']
  }
]

const sideRailGroupIcons: Record<string, string> = {
  Plan: '/lineicons/clipboard.svg',
  Develop: '/lineicons/coverage-grid.svg',
  Verify: '/lineicons/check-circle-1.svg',
  Deploy: '/lineicons/deployment-guide.svg',
  Monitor: '/lineicons/heart.svg',
  AI: '/lineicons/codex-spark.svg',
  Sentinel: '/lineicons/shield-2-check.svg',
  System: '/lineicons/gear-1.svg',
  Other: '/lineicons/layers-1.svg'
}

export function DashboardShell({ children, nav, subLabels }: DashboardShellProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [language, setLanguage] = useState<'en' | 'es'>('en')
  const [readyCritical, setReadyCritical] = useState(0)
  const [heartbeat, setHeartbeat] = useState<HeartbeatState | null>(null)
  const [metrics, setMetrics] = useState<ProjectMetrics | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [mobileGroup, setMobileGroup] = useState<string | null>(null)
  const [navPending, startNav] = useTransition()
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null)
  const refreshInFlight = useRef(false)
  const heartbeatInFlight = useRef(false)
  const headerActionsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const savedTheme = window.localStorage.getItem('docmee-theme')
    const savedLanguage = window.localStorage.getItem('docmee-language')
    const savedAutoRefresh = window.localStorage.getItem('docmee-auto-refresh')
    if (savedTheme === 'light' || savedTheme === 'dark') setTheme(savedTheme)
    if (savedLanguage === 'en' || savedLanguage === 'es') setLanguage(savedLanguage)
    if (savedAutoRefresh === 'false') setAutoRefresh(false)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.lang = language
  }, [theme, language])

  function refreshReady() {
    return fetch('/api/ready/status', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data: { critical?: number }) => setReadyCritical(data.critical ?? 0))
      .catch(() => setReadyCritical(0))
  }

  function refreshHeartbeat() {
    return fetch('/api/install-monitor/status', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data: HeartbeatState) => setHeartbeat(data))
      .catch(() => setHeartbeat({ live: false, heartbeat: { status: 'unknown' } }))
  }

  function refreshMetrics() {
    return fetch('/api/project-metrics', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data: ProjectMetrics) => setMetrics(data))
      .catch(() => setMetrics(null))
  }

  function refreshNow(refreshPage = false) {
    if (refreshInFlight.current) return
    refreshInFlight.current = true
    setRefreshing(true)
    Promise.allSettled([refreshReady(), refreshHeartbeat(), refreshMetrics()])
      .then(() => {
        setLastRefreshAt(new Date().toISOString())
        if (refreshPage && document.visibilityState === 'visible') router.refresh()
      })
      .finally(() => {
        refreshInFlight.current = false
        setRefreshing(false)
      })
  }

  useEffect(() => {
    refreshReady()
    refreshMetrics()
  }, [])

  useEffect(() => {
    let mounted = true
    function pollHeartbeat(force = false) {
      if (heartbeatInFlight.current || (!force && document.visibilityState !== 'visible')) return
      heartbeatInFlight.current = true
      fetch('/api/install-monitor/status', { cache: 'no-store' })
        .then((response) => response.json())
        .then((data: HeartbeatState) => {
          if (mounted) setHeartbeat(data)
        })
        .catch(() => {
          if (mounted) setHeartbeat({ live: false, heartbeat: { status: 'unknown' } })
        })
        .finally(() => {
          heartbeatInFlight.current = false
        })
    }
    pollHeartbeat(true)
    const timer = window.setInterval(pollHeartbeat, 10000)
    return () => {
      mounted = false
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!autoRefresh) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshNow(true)
    }, 30000)
    return () => window.clearInterval(timer)
  }, [autoRefresh, router])

  useEffect(() => {
    function resetHeaderScroll() {
      window.requestAnimationFrame(() => {
        if (headerActionsRef.current) headerActionsRef.current.scrollLeft = 0
      })
    }
    resetHeaderScroll()
    window.addEventListener('resize', resetHeaderScroll)
    return () => window.removeEventListener('resize', resetHeaderScroll)
  }, [pathname])

  useEffect(() => {
    setMobileGroup(null)
    setPendingHref(null)
  }, [pathname])

  // Route nav clicks through a transition so we can show an immediate loading
  // affordance (top progress bar + per-item spinner) instead of the UI looking
  // frozen while the next route's server component streams.
  function handleNavClick(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (event.defaultPrevented) return
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (href === pathname) return
    event.preventDefault()
    setPendingHref(href)
    startNav(() => router.push(href))
  }

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    window.localStorage.setItem('docmee-theme', next)
  }

  function toggleLanguage() {
    const next = language === 'en' ? 'es' : 'en'
    setLanguage(next)
    window.localStorage.setItem('docmee-language', next)
  }

  function toggleAutoRefresh() {
    const next = !autoRefresh
    setAutoRefresh(next)
    window.localStorage.setItem('docmee-auto-refresh', String(next))
  }

  function goBack() {
    window.history.back()
  }

  function goForward() {
    window.history.forward()
  }

  function labelFor(label: string) {
    return language === 'es' ? spanishLabels[label] ?? label : label
  }

  function navIconFor(label: string, active = false) {
    const icon = navIcons[label]
    return (
      <span className={`grid h-10 w-10 place-items-center rounded-md border ${active ? 'border-cyan-300/50 bg-cyan-400/15 text-cyan-100' : 'border-slate-700/70 bg-slate-900/70 text-slate-300'}`}>
        {typeof icon === 'string' ? (
          <span
            aria-hidden="true"
            className="h-5 w-5 bg-current"
            style={{
              WebkitMask: `url(${icon}) center / contain no-repeat`,
              mask: `url(${icon}) center / contain no-repeat`
            }}
          />
        ) : (
          <svg
            aria-hidden="true"
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {icon ?? <path d="M12 5v14M5 12h14" />}
          </svg>
        )}
      </span>
    )
  }

  function navSpinner() {
    return (
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-cyan-300/50 bg-cyan-400/15">
        <span className="devtools-loading-spinner devtools-loading-spinner-sm" aria-hidden="true" />
      </span>
    )
  }

  function heartbeatTone(status?: string) {
    if (status === 'normal') return 'text-emerald-300 border-emerald-700/70 bg-emerald-950/30'
    if (status === 'paused' || status === 'delayed' || status === 'sentinel') return 'text-amber-300 border-amber-700/70 bg-amber-950/30'
    if (status === 'lost' || status === 'dead') return 'text-red-300 border-red-700/70 bg-red-950/30'
    return 'text-slate-300 border-slate-700 bg-slate-900/70'
  }

  function heartbeatLabel(status?: string) {
    if (status === 'normal') return language === 'es' ? 'Vivo' : 'Live'
    if (status === 'paused') return language === 'es' ? 'Pausado' : 'Paused'
    if (status === 'sentinel') return language === 'es' ? 'Revisando' : 'Checking'
    if (status === 'delayed') return language === 'es' ? 'Lento' : 'Delayed'
    if (status === 'lost') return language === 'es' ? 'Perdido' : 'Lost'
    if (status === 'dead') return language === 'es' ? 'Muerto' : 'Dead'
    if (status === 'stopped') return language === 'es' ? 'Detenido' : 'Stopped'
    return language === 'es' ? 'Desconocido' : 'Unknown'
  }

  function shortMoney(value?: number) {
    if (typeof value !== 'number') return '$0.00'
    return `$${value.toFixed(value >= 10 ? 2 : 4)}`
  }

  function shortNumber(value?: number) {
    if (typeof value !== 'number') return '0'
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
    if (value >= 1000) return `${(value / 1000).toFixed(1)}K`
    return String(value)
  }

  function maskIcon(src: string, className = 'h-4 w-4') {
    return (
      <span
        aria-hidden="true"
        className={`${className} bg-current`}
        style={{
          WebkitMask: `url(${src}) center / contain no-repeat`,
          mask: `url(${src}) center / contain no-repeat`
        }}
      />
    )
  }

  const currentLabel = nav.find(([, href]) => pathname === href || (href !== '/' && pathname.startsWith(href)))?.[0] ?? 'Overview'
  const readyText = readyCritical > 0 ? `${readyCritical} blockers` : 'Ready'
  const buildHeartbeatText = `Build heartbeat: ${heartbeatLabel(heartbeat?.heartbeat?.status)}${heartbeat?.run?.phase ? `, ${heartbeat.run.phase}` : ''}`
  const featureHeartbeatText = `Backend heartbeat: ${heartbeatLabel(heartbeat?.featureHeartbeat?.status)}${heartbeat?.featureRun?.phase ? `, ${heartbeat.featureRun.phase}` : ''}`
  const frontendHeartbeatText = `Frontend heartbeat: ${heartbeatLabel(heartbeat?.frontendHeartbeat?.status)}${heartbeat?.frontendRun?.phase ? `, ${heartbeat.frontendRun.phase}` : ''}`
  const uiHeartbeatText = `UI heartbeat: ${heartbeatLabel(heartbeat?.uiHeartbeat?.status)}${heartbeat?.uiRun?.phase ? `, ${heartbeat.uiRun.phase}` : ''}`
  // Inject user-added AIs (those with a role sublabel) into the AI group, before Agents.
  const customAiLabels = Object.keys(subLabels ?? {})
  const resolvedGroups = customAiLabels.length
    ? sideRailGroups.map((group) => group.label === 'AI'
      ? { ...group, items: [...group.items.filter((item) => item !== 'Agents'), ...customAiLabels, 'Agents'] }
      : group)
    : sideRailGroups
  const navByLabel = new Map(nav.map((item) => [item[0], item]))
  const groupedNavLabels = new Set(resolvedGroups.flatMap((group) => group.items))
  const groupedSideRail = [
    ...resolvedGroups.map((group) => ({
      ...group,
      items: group.items.map((label) => navByLabel.get(label)).filter((item): item is NavItem => Boolean(item))
    })).filter((group) => group.items.length > 0),
    {
      label: 'Other',
      items: nav.filter(([label]) => !groupedNavLabels.has(label))
    }
  ].filter((group) => group.items.length > 0)
  const openMobileGroup = mobileGroup ? groupedSideRail.find((group) => group.label === mobileGroup) ?? null : null

  return (
    <SpanishTranslator language={language}>
    <div className={`theme-${theme} app-shell flex min-h-screen text-slate-100`}>
      <div className={`nav-progress ${navPending ? 'nav-progress-active' : ''}`} role="progressbar" aria-hidden={!navPending} aria-label="Loading next page" />
      <aside className="app-sidebar hidden h-screen w-20 shrink-0 overflow-visible border-r p-3 md:block">
        <div className="mb-5 flex flex-col items-center gap-2">
          <Link href="/" className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-cyan-400/40 bg-cyan-400/10 text-cyan-100" title="Docmee DevTools" aria-label="Docmee DevTools home">
            <span className="text-sm font-semibold">D</span>
          </Link>
        </div>
        <nav className="app-sidebar-nav space-y-2" aria-label="Primary navigation">
          {groupedSideRail.map((group) => {
            const groupActive = group.items.some(([, href]) => pathname === href || (href !== '/' && pathname.startsWith(href)))
            return (
            <div key={group.label} className="app-sidebar-group relative">
              <button
                type="button"
                className={`app-sidebar-group-trigger grid min-h-12 w-full place-items-center rounded-md text-sm hover:text-white ${groupActive ? 'bg-cyan-500/10 text-cyan-100 ring-1 ring-cyan-400/30' : 'text-slate-300 hover:bg-slate-800'}`}
                aria-haspopup="menu"
                aria-label={`${group.label} menu`}
                title={`${group.label} menu`}
              >
                <span className={`grid h-10 w-10 place-items-center rounded-md border ${groupActive ? 'border-cyan-300/50 bg-cyan-400/15 text-cyan-100' : 'border-slate-700/70 bg-slate-900/70 text-slate-300'}`}>
                  {maskIcon(sideRailGroupIcons[group.label] ?? sideRailGroupIcons.Other, 'h-5 w-5')}
                </span>
                <span className="mt-1 text-[9px] font-semibold uppercase leading-none tracking-[0.06em] text-slate-500">{group.label}</span>
              </button>
              <div className="app-sidebar-submenu" role="menu" aria-label={`${group.label} submenu`}>
                <div className="mb-2 flex items-center gap-2 border-b border-slate-800 pb-2">
                  <span className="text-cyan-100">{maskIcon(sideRailGroupIcons[group.label] ?? sideRailGroupIcons.Other, 'h-4 w-4')}</span>
                  <span className="text-sm font-semibold text-slate-100">{group.label}</span>
                </div>
                <div className="grid gap-1">
                  {group.items.map(([label, href]) => {
                    const displayLabel = labelFor(label)
                    const active = pathname === href || (href !== '/' && pathname.startsWith(href))
                    return (
                      <Link
                        key={href}
                        href={href}
                        role="menuitem"
                        title={displayLabel}
                        aria-label={displayLabel}
                        aria-busy={pendingHref === href}
                        onClick={(event) => handleNavClick(event, href)}
                        className={`app-sidebar-submenu-link flex min-h-10 items-center gap-2 rounded-md px-2.5 py-2 text-sm ${active ? 'bg-cyan-500/10 text-cyan-100 ring-1 ring-cyan-400/30' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
                      >
                        {pendingHref === href ? navSpinner() : navIconFor(label, active)}
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate">{displayLabel}</span>
                          {subLabels?.[label] && <span className="truncate text-[10px] font-medium uppercase tracking-wide leading-tight text-cyan-300/70">{subLabels[label]}</span>}
                        </span>
                      </Link>
                    )
                  })}
                </div>
              </div>
            </div>
            )
          })}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto pb-20 md:pb-0">
        <header className="app-header sticky top-0 z-30 flex min-h-11 flex-col gap-1 border-b px-3 py-1 sm:flex-row sm:items-center sm:justify-between md:px-4 lg:px-5">
          <div className="flex min-w-0 items-center justify-between gap-2 sm:block sm:w-32 sm:shrink-0 lg:w-36">
            <Link href="/" className="text-base font-semibold md:hidden">Docmee DevTools</Link>
            <div className="hidden md:block">
              <div className="truncate text-xs leading-4 text-slate-500">Current workspace</div>
              <div className="max-w-full whitespace-normal text-sm font-medium leading-5 text-slate-200">{labelFor(currentLabel)}</div>
            </div>
            <Link href="/ready" onClick={(event) => handleNavClick(event, '/ready')} className={`shrink-0 rounded-md border px-2.5 py-1.5 text-xs sm:hidden ${readyCritical > 0 ? 'border-red-700/70 text-red-200' : 'border-emerald-700/70 text-emerald-200'}`}>
              {readyText}
            </Link>
          </div>
          <div ref={headerActionsRef} className="app-header-actions flex w-full items-center overflow-x-auto overflow-y-hidden pb-1 sm:w-auto sm:max-w-[calc(100vw-12rem)] sm:justify-start md:pb-0">
          <button
            type="button"
            onClick={goBack}
            className="ui-action grid min-h-11 min-w-11 place-items-center rounded-md border px-3 py-2 text-sm text-slate-300 hover:text-white"
            aria-label="Go back"
            title="Go back"
          >
            <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" />
              <path d="m12 5-7 7 7 7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={goForward}
            className="ui-action grid min-h-11 min-w-11 place-items-center rounded-md border px-3 py-2 text-sm text-slate-300 hover:text-white"
            aria-label="Go forward"
            title="Go forward"
          >
            <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </button>
          <Link
            href="/"
            className="ui-action grid min-h-11 min-w-11 place-items-center rounded-md border px-3 py-2 text-sm text-slate-300 hover:text-white"
            aria-label="Go home"
            title="Go home"
          >
            <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 11.5 12 4l9 7.5" />
              <path d="M5.5 10.5V20h13v-9.5" />
              <path d="M9.5 20v-5.5h5V20" />
            </svg>
          </Link>
          <Link
            href="/install-monitor"
            onClick={(event) => handleNavClick(event, '/install-monitor')}
            className={`heartbeat-pill flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-sm ${heartbeatTone(heartbeat?.heartbeat?.status)}`}
            title={heartbeat?.run?.message ?? 'Build heartbeat status'}
            aria-label={buildHeartbeatText}
          >
            <span className={`heartbeat-heart ${heartbeat?.heartbeat?.status === 'normal' ? 'heartbeat-heart-live' : ''}`} aria-hidden="true">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                <path d="M12 21s-7.2-4.6-9.5-9.1C.6 8.1 2.8 4 6.8 4c2 0 3.7 1 5.2 2.9C13.5 5 15.2 4 17.2 4c4 0 6.2 4.1 4.3 7.9C19.2 16.4 12 21 12 21Z" />
              </svg>
            </span>
            <span className="hidden sm:inline">Build</span>
            <span className="hidden xl:inline">{heartbeatLabel(heartbeat?.heartbeat?.status)}</span>
            {heartbeat?.run?.phase && <span className="hidden rounded bg-slate-950/40 px-1.5 py-0.5 text-xs 2xl:inline">{heartbeat.run.phase}</span>}
          </Link>
          <Link
            href="/rev1-coverage"
            onClick={(event) => handleNavClick(event, '/rev1-coverage')}
            className={`heartbeat-pill flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-sm ${heartbeatTone(heartbeat?.featureHeartbeat?.status)}`}
            title={heartbeat?.featureRun?.message ?? 'Backend heartbeat status'}
            aria-label={featureHeartbeatText}
          >
            <span className={`heartbeat-heart ${heartbeat?.featureHeartbeat?.status === 'normal' ? 'heartbeat-heart-live' : ''}`} aria-hidden="true">
              {maskIcon('/lineicons/coverage-grid.svg', 'h-5 w-5')}
            </span>
            <span className="hidden sm:inline">Backend</span>
            <span className="hidden xl:inline">{heartbeatLabel(heartbeat?.featureHeartbeat?.status)}</span>
            {heartbeat?.featureRun?.phase && <span className="hidden rounded bg-slate-950/40 px-1.5 py-0.5 text-xs 2xl:inline">{heartbeat.featureRun.phase}</span>}
          </Link>
          <Link
            href="/frontend-build-control"
            onClick={(event) => handleNavClick(event, '/frontend-build-control')}
            className={`heartbeat-pill flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-sm ${heartbeatTone(heartbeat?.frontendHeartbeat?.status)}`}
            title={heartbeat?.frontendRun?.message ?? 'Frontend heartbeat status'}
            aria-label={frontendHeartbeatText}
          >
            <span className={`heartbeat-heart ${heartbeat?.frontendHeartbeat?.status === 'normal' ? 'heartbeat-heart-live' : ''}`} aria-hidden="true">
              {maskIcon('/lineicons/layers-1.svg', 'h-5 w-5')}
            </span>
            <span className="hidden sm:inline">Frontend</span>
            <span className="hidden xl:inline">{heartbeatLabel(heartbeat?.frontendHeartbeat?.status)}</span>
            {heartbeat?.frontendRun?.phase && <span className="hidden rounded bg-slate-950/40 px-1.5 py-0.5 text-xs 2xl:inline">{heartbeat.frontendRun.phase}</span>}
          </Link>
          <Link
            href="/docmee-audit"
            onClick={(event) => handleNavClick(event, '/docmee-audit')}
            className={`heartbeat-pill flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-sm ${heartbeatTone(heartbeat?.uiHeartbeat?.status)}`}
            title={heartbeat?.uiRun?.message ?? 'UI development heartbeat status'}
            aria-label={uiHeartbeatText}
          >
            <span className={`heartbeat-heart ${heartbeat?.uiHeartbeat?.status === 'normal' ? 'heartbeat-heart-live' : ''}`} aria-hidden="true">
              {maskIcon('/lineicons/verify-report.svg', 'h-5 w-5')}
            </span>
            <span className="hidden sm:inline">UI</span>
            <span className="hidden xl:inline">{heartbeatLabel(heartbeat?.uiHeartbeat?.status)}</span>
            {heartbeat?.uiRun?.phase && <span className="hidden rounded bg-slate-950/40 px-1.5 py-0.5 text-xs 2xl:inline">{heartbeat.uiRun.phase}</span>}
          </Link>
          <button
            type="button"
            onClick={() => refreshNow(true)}
            className="ui-action grid min-h-11 min-w-11 place-items-center rounded-md border px-3 py-2 text-sm text-slate-300 hover:text-white"
            aria-label="Refresh DevTools view"
            title={lastRefreshAt ? `Refresh DevTools view. Last refresh ${new Date(lastRefreshAt).toLocaleTimeString()}` : 'Refresh DevTools view'}
          >
            <svg aria-hidden="true" className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 12a8 8 0 1 1-2.35-5.65" />
              <path d="M20 4v5h-5" />
            </svg>
          </button>
          <button
            type="button"
            onClick={toggleAutoRefresh}
            className={`ui-action flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-sm ${autoRefresh ? 'text-emerald-300' : 'text-slate-300'} hover:text-white`}
            aria-label={autoRefresh ? 'Turn off auto refresh' : 'Turn on auto refresh'}
              title={autoRefresh ? 'Auto refresh is on: updates the desktop UI every 30 seconds' : 'Auto refresh is off'}
          >
            <span className={`h-2.5 w-2.5 rounded-full ${autoRefresh ? 'bg-emerald-400' : 'bg-slate-500'}`} />
            <span className="hidden lg:inline">{autoRefresh ? 'Auto' : 'Manual'}</span>
          </button>
          <Link
            href="/cost"
            onClick={(event) => handleNavClick(event, '/cost')}
            className="topbar-cost-pill heartbeat-pill flex min-h-11 max-w-full items-center gap-2 rounded-md border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs text-slate-300 hover:text-white"
            title={`Build total includes backend + frontend + UI. Backend ${shortMoney(metrics?.backendCost)} / ${shortNumber(metrics?.backendTokens)} tokens · Frontend ${shortMoney(metrics?.frontendCost)} / ${shortNumber(metrics?.frontendTokens)} tokens · UI ${shortMoney(metrics?.uiCost)} / ${shortNumber(metrics?.uiTokens)} tokens · Current phase ${metrics?.phase?.current ?? heartbeat?.run?.phase ?? 'unknown'}`}
          >
            <span className="text-cyan-100">{maskIcon('/lineicons/dollar-circle.svg')}</span>
            <span className="font-semibold text-slate-100">{shortMoney(metrics?.totalCost)}</span>
            <span className="hidden text-slate-500 xl:inline">|</span>
            <span className="hidden items-center gap-1 xl:flex">{maskIcon('/lineicons/bar-chart-4.svg', 'h-3.5 w-3.5')} {metrics?.phase?.done ?? 0}/{metrics?.phase?.total ?? 19}</span>
            <span className="hidden text-slate-500 2xl:inline">|</span>
            <span className="hidden 2xl:inline">{shortNumber(metrics?.totalTokens)} tokens</span>
            <span className="rounded bg-slate-950/40 px-1.5 py-0.5 font-mono text-xs text-cyan-100">{metrics?.phase?.current ?? heartbeat?.run?.phase ?? 'P--'}</span>
          </Link>
          <Link href="/ready" onClick={(event) => handleNavClick(event, '/ready')} className={readyCritical > 0 ? 'hidden min-h-11 rounded-md border border-red-700/70 px-3 py-2 text-sm text-red-200 hover:bg-red-950/50 sm:inline-flex sm:items-center' : 'hidden min-h-11 rounded-md border border-emerald-700/70 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-950/40 sm:inline-flex sm:items-center'}>
            {readyText}
          </Link>
          <button
            type="button"
            onClick={toggleTheme}
            className={`ui-action grid min-h-11 min-w-11 place-items-center rounded-md border px-3 py-2 text-sm hover:text-white ${theme === 'light' ? 'text-amber-300' : 'text-slate-300'}`}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            <svg
              aria-hidden="true"
              className={`h-5 w-5 transition-all ${theme === 'light' ? 'drop-shadow-[0_0_8px_rgba(251,191,36,0.65)]' : ''}`}
              viewBox="0 0 24 24"
              fill={theme === 'light' ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 18h6" />
              <path d="M10 22h4" />
              <path d="M12 2a7 7 0 0 0-4 12.7c.7.5 1 1.1 1 1.8V17h6v-.5c0-.7.3-1.3 1-1.8A7 7 0 0 0 12 2Z" />
              {theme === 'light' && <path d="M12 5v2M4 12h2M18 12h2M6.6 6.6 8 8M16 8l1.4-1.4" fill="none" />}
            </svg>
          </button>
          <button
            type="button"
            onClick={toggleLanguage}
            className="ui-action min-h-11 rounded-md border px-3 py-2 text-sm text-slate-300 hover:text-white"
            aria-label="Toggle English and Spanish"
          >
            {language === 'en' ? 'Español' : 'English'}
          </button>
          </div>
        </header>
        <div className="dashboard-content max-w-full p-3 md:p-4 lg:p-5">
          {children}
        </div>
      </main>

      <nav className="app-mobile-nav fixed inset-x-0 bottom-0 z-40 border-t md:hidden" aria-label="Mobile navigation">
        {openMobileGroup && (
          <div className="mobile-group-panel max-h-[58vh] overflow-y-auto border-b border-slate-800 p-2" role="menu" aria-label={`${openMobileGroup.label} pages`}>
            <div className="mb-2 flex items-center justify-between px-1">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-300">
                <span className="text-cyan-100">{maskIcon(sideRailGroupIcons[openMobileGroup.label] ?? sideRailGroupIcons.Other, 'h-4 w-4')}</span>
                {openMobileGroup.label}
              </div>
              <button
                type="button"
                onClick={() => setMobileGroup(null)}
                className="grid min-h-9 min-w-9 place-items-center rounded-md border border-slate-700 text-slate-300"
                aria-label="Close menu"
              >
                <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {openMobileGroup.items.map(([label, href]) => {
                const active = pathname === href || (href !== '/' && pathname.startsWith(href))
                return (
                  <Link
                    key={href}
                    href={href}
                    role="menuitem"
                    aria-busy={pendingHref === href}
                    onClick={(event) => handleNavClick(event, href)}
                    className={`relative flex min-h-12 items-center gap-2 rounded-md px-2.5 py-2 text-sm ${active ? 'bg-cyan-500/10 text-cyan-100 ring-1 ring-cyan-400/30' : 'text-slate-300 hover:bg-slate-800'}`}
                  >
                    {label === 'Ready' && readyCritical > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500" />}
                    <span className="scale-90">{pendingHref === href ? navSpinner() : navIconFor(label, active)}</span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{labelFor(label)}</span>
                      {subLabels?.[label] && <span className="truncate text-[10px] uppercase tracking-wide leading-tight text-cyan-300/70">{subLabels[label]}</span>}
                    </span>
                  </Link>
                )
              })}
            </div>
          </div>
        )}
        <div className="flex gap-1 overflow-x-auto px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2">
          {groupedSideRail.map((group) => {
            const groupActive = group.items.some(([, href]) => pathname === href || (href !== '/' && pathname.startsWith(href)))
            const isOpen = openMobileGroup?.label === group.label
            const hasBlocker = readyCritical > 0 && group.items.some(([label]) => label === 'Ready')
            return (
              <button
                key={group.label}
                type="button"
                onClick={() => setMobileGroup(isOpen ? null : group.label)}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                className={`relative grid min-h-14 w-[4.5rem] flex-none place-items-center rounded-md px-1 py-1 text-center text-[11px] ${isOpen || groupActive ? 'bg-cyan-500/10 text-cyan-100 ring-1 ring-cyan-400/30' : 'text-slate-300 hover:bg-slate-800'}`}
              >
                {hasBlocker && <span className="absolute right-2 top-1 h-2 w-2 rounded-full bg-red-500" />}
                <span className={`grid h-8 w-8 place-items-center rounded-md border ${isOpen || groupActive ? 'border-cyan-300/50 bg-cyan-400/15 text-cyan-100' : 'border-slate-700/70 bg-slate-900/70 text-slate-300'}`}>
                  {maskIcon(sideRailGroupIcons[group.label] ?? sideRailGroupIcons.Other, 'h-4 w-4')}
                </span>
                <span className="mt-0.5 w-full leading-tight">{group.label}</span>
              </button>
            )
          })}
        </div>
      </nav>
    </div>
    </SpanishTranslator>
  )
}
