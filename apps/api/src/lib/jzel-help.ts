interface JzelHelpArticle {
  id: string
  route: string
  source: string
  text: string
  terms: string[]
}

/** Bounded, server-owned product help. Questions select one article; the browser never supplies help text. */
const HELP_ARTICLES: JzelHelpArticle[] = [
  {
    id: 'workflow-builder', route: '/studio/workflows', source: 'Workflow Builder',
    terms: ['workflow builder', 'workflow', 'workflows', 'flujo de trabajo', 'flujos', 'flujo', 'node', 'nodes', 'nodo', 'nodos'],
    text: 'Workflow Builder: open Admin Studio > Workflows, create or open a draft, add supported nodes, connect every outcome, and review the graph before publishing. Published workflows handle live conversations; edits remain in a draft until they are published.',
  },
  {
    id: 'automations', route: '/studio/automations', source: 'Automations',
    terms: ['automation', 'automations', 'scheduled report', 'scheduled reports', 'automatizacion', 'automatizaciones', 'reporte programado', 'reportes programados'],
    text: 'Automations: open Admin Studio > Automations to configure scheduled reports and assistant behavior. Review the clinic, schedule, delivery destination, and active status before saving.',
  },
  {
    id: 'channels-integrations', route: '/studio/channels', source: 'Channels & Integrations',
    terms: ['channel status', 'channels', 'channel', 'integrations', 'integration', 'whatsapp', 'estado del canal', 'canales', 'canal', 'integraciones', 'integracion'],
    text: 'Channels & Integrations: open Admin Studio > Channels, select the clinic and provider, then check that the connection status is active. Use the available test action after saving. Integrations can include WhatsApp, Google Calendar, Google Sheets, and provider connections. Add provider keys only in the protected settings fields; never paste credentials into chat.',
  },
  {
    id: 'inbox', route: '/inbox', source: 'Inbox',
    terms: ['inbox', 'conversation', 'conversations', 'message assignment', 'assign message', 'bandeja', 'conversacion', 'conversaciones', 'asignar mensaje'],
    text: 'Inbox: open Inbox to review conversations, messages, assignments, and patient context. Select a conversation, use the patient panel for appointment history, and assign the conversation to the appropriate staff member when follow-up is needed.',
  },
  {
    id: 'knowledge-agent', route: '/studio/kb', source: 'Knowledge Base & Teach the agent',
    terms: ['knowledge base', 'knowledge', 'teach the agent', 'teach agent', 'j zel', 'jzel', 'base de conocimiento', 'ensenar al agente', 'ensenar agente'],
    text: 'Knowledge Base and Teach the agent: open Admin Studio > Knowledge Base to add clinic facts and documents. Review scope, duplicates, conflicts, and the proposed change before approval. Wait until indexing is complete before testing the answer in Teach the agent.',
  },
  {
    id: 'calendar-appointments', route: '/calendar', source: 'Calendar & Appointments',
    terms: ['appointment', 'appointments', 'booking', 'bookings', 'calendar', 'reschedule', 'cancel appointment', 'cita', 'citas', 'calendario', 'reserva', 'reservas', 'reprogramar', 'cancelar cita'],
    text: 'Calendar and appointments: open Calendar to review bookings and their patient details. Booking workflows should collect the patient name and contact details before creating the event. Use the dedicated reschedule or cancel action so Docmee updates the linked booking and calendar event consistently.',
  },
  {
    id: 'users-permissions', route: '/studio/users', source: 'Users & Permissions',
    terms: ['user', 'users', 'permission', 'permissions', 'role', 'roles', 'access', 'usuario', 'usuarios', 'permiso', 'permisos', 'rol', 'acceso'],
    text: 'Users and permissions: open Admin Studio > Users, select the clinic, invite or open the user, choose the minimum role needed for their work, and save. Recheck access after changing a role.',
  },
  {
    id: 'templates-quick-replies', route: '/studio/templates', source: 'Templates & Quick Replies',
    terms: ['template', 'templates', 'quick reply', 'quick replies', 'plantilla', 'plantillas', 'respuesta rapida', 'respuestas rapidas'],
    text: 'Templates and quick replies: open the clinic template or quick-reply area, create or edit the response, confirm its language and clinic scope, then save. Test the wording in a non-patient preview before staff use it.',
  },
  {
    id: 'reports-metrics', route: '/reports', source: 'Reports & Metrics',
    terms: ['report', 'reports', 'metric', 'metrics', 'analytics', 'reporte', 'reportes', 'metrica', 'metricas', 'analitica'],
    text: 'Reports and metrics: open Reports or Analytics, select the clinic and date range, then review the relevant operational view. Scheduled delivery is configured in Automations.',
  },
  {
    id: 'security-troubleshooting', route: '/help', source: 'Security & Troubleshooting',
    terms: ['security', 'troubleshoot', 'troubleshooting', 'errors', 'seguridad', 'solucion de problemas', 'errores'],
    text: 'Security and troubleshooting: confirm the selected clinic, your role, the channel connection, and the visible error first. Do not paste passwords, provider keys, patient records, or other credentials into chat. Contact soporte@docmee.ai when the problem needs protected account or infrastructure access.',
  },
]

function normalize(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)
}

function validRoute(route: unknown): string | null {
  return typeof route === 'string' && route.length <= 160 && route.startsWith('/') ? route : null
}

function routeArticle(route: unknown): JzelHelpArticle | null {
  const value = validRoute(route)
  if (!value) return null
  return HELP_ARTICLES.find((article) => value === article.route || value.startsWith(`${article.route}/`)) ?? null
}

function publicArticle(article: JzelHelpArticle) {
  return { id: article.id, text: article.text, source: article.source }
}

export function helpForJzelRoute(route: unknown): { text: string; source: string } | null {
  const article = routeArticle(route)
  return article ? { text: article.text, source: article.source } : null
}

export function helpForJzelQuestion(
  message: unknown,
  route: unknown,
): { id: string; text: string; source: string } | null {
  const query = normalize(message)
  if (!query) return null

  // Topic words alone are ambiguous (for example, a clinic can have its own
  // appointment cancellation policy). Require navigation/configuration intent,
  // or an explicit Docmee feature name, before selecting product documentation.
  const productHelpIntent = /\b(open|find|check|configure|connect|set up|setup|use|manage|create|edit|status|abrir|encontrar|revis\w*|configur\w*|conectar|usar|gestion\w*|crear|editar|estado)\b/.test(query)
  const namedProduct = /\b(workflow builder|knowledge base|teach the agent|j zel|jzel|admin studio)\b/.test(query)
  const scored = (productHelpIntent || namedProduct ? HELP_ARTICLES : []).map((article) => ({
    article,
    score: article.terms.reduce((score, term) => {
      const normalizedTerm = normalize(term)
      if (!normalizedTerm || !(` ${query} `.includes(` ${normalizedTerm} `))) return score
      return score + (normalizedTerm.includes(' ') ? 3 : 1)
    }, 0),
  })).filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.article.id.localeCompare(right.article.id))

  if (scored[0]) return publicArticle(scored[0].article)

  const contextualRequest = /^(help|help me|ayuda|ayudame|how do i use (this|the) page|como (uso|se usa) (esta|la) pagina|what can i do (here|on this page)|que puedo hacer (aqui|en esta pagina))$/.test(query)
  const contextual = contextualRequest ? routeArticle(route) : null
  return contextual ? publicArticle(contextual) : null
}
