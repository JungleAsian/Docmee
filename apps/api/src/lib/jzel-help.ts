/** Server-owned, route-scoped help. The browser sends only a route identifier. */
const HELP_BY_ROUTE: Array<{ prefix: string; text: string; source: string }> = [
  { prefix: '/studio/workflows', source: 'Workflow Builder', text: 'Workflow Builder: create a draft, choose a supported trigger, connect actions, then activate only after reviewing the graph. Supported triggers are keyword and patient-upset messages.' },
  { prefix: '/studio/automations', source: 'Automations', text: 'Automations: configure scheduled reports and AI Assistant behavior. Report frequency and delivery settings are managed here.' },
  { prefix: '/studio/channels', source: 'Channels & Integrations', text: 'Channels & Integrations: connect approved providers and configure clinic-scoped credentials. Never paste credentials into chat.' },
  { prefix: '/inbox', source: 'Inbox', text: 'Inbox: review conversations, messages, assignments, and patient context. Use the patient panel for appointment history.' },
]

export function helpForJzelRoute(route: unknown): { text: string; source: string } | null {
  if (typeof route !== 'string' || route.length > 160 || !route.startsWith('/')) return null
  const match = HELP_BY_ROUTE.find((entry) => route === entry.prefix || route.startsWith(`${entry.prefix}/`))
  return match ? { text: match.text, source: match.source } : null
}
