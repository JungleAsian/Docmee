import './globals.css'
import type { ReactNode } from 'react'
import type { Viewport } from 'next'
import type { NavItem } from './shell'
import { DashboardShell } from './shell'
import { FormSubmitFeedback } from './form-submit-feedback'
import { readCustomAis } from './lib/custom-ais'

// Drive layout off the real device form factor: device-width scaling, full-bleed
// into safe areas (notches / rounded corners), and zoom left enabled for a11y.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: '#0b1220',
}

const nav: NavItem[] = [
  ['Mission Control', '/overview'],
  ['Workflow', '/workflow'],
  ['Ready', '/ready'],
  ['Backlog', '/backlog'],
  ['Features Development', '/rev1-coverage'],
  ['Docmee - UI', '/docmee-audit'],
  ['Docmee Deployment', '/docmee-deployment'],
  ['Frontend Build Control', '/frontend-build-control'],
  ['Enhancements', '/enhancements'],
  ['Claude', '/claude-switch'],
  ['Codex', '/codex-switch'],
  ['Grok', '/grok'],
  ['Gemini', '/gemini'],
  ['Build Control', '/build-control'],
  ['Six Gates', '/gates'],
  ['Post-Deployment Log', '/post-deployment'],
  ['Pre-deployment', '/predeployment'],
  ['Docmee Update', '/docmee-update'],
  ['Deploy', '/deploy'],
  ['Install Monitor', '/install-monitor'],
  ['Sentinel', '/sentinel'],
  ['Healer', '/healer'],
  ['Beacon', '/beacon'],
  ['Forge', '/forge'],
  ['Guardian', '/guardian'],
  ['Aegis', '/aegis'],
  ['Cortex', '/cortex'],
  ['Diagnostics', '/diagnostics'],
  ['Activity', '/activity'],
  ['Journal', '/journal'],
  ['Logs', '/logs'],
  ['Discord Status', '/discord'],
  ['Development Cost', '/cost'],
  ['Stack Intelligence', '/stack'],
  ['Agents', '/agents'],
  ['Webhook Console', '/webhooks'],
  ['Seed Generator', '/seed'],
  ['Settings', '/settings']
]

export default function RootLayout({ children }: { children: ReactNode }) {
  const customAis = readCustomAis()
  const fullNav: NavItem[] = [...nav, ...customAis.map((ai): NavItem => [ai.name, `/ai/${ai.id}`])]
  const subLabels = Object.fromEntries(customAis.map((ai) => [ai.name, ai.role]))
  return (
    <html lang="en">
      <body>
        <FormSubmitFeedback />
        <DashboardShell nav={fullNav} subLabels={subLabels}>{children}</DashboardShell>
      </body>
    </html>
  )
}
